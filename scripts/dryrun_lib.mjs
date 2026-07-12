#!/usr/bin/env node
/**
 * dryrun_lib.mjs — foot 도메인 공용 무영속(no-persistence) 마이그레이션 dry-run 러너.
 *
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md v1.0
 *       (owner=data-architect, exec_owner=supervisor, AC-1 확정 2026-07-12)
 * FIX-REQUEST: MSG-20260712-183610-t8ft / T-20260712-meta-DRYRUN-SENTINEL-BYPASS-STD
 * reference impl: obliv-scalp-crm/scripts/dryrun_lib.py 의 3요소 구조를 foot 로 포팅.
 *
 * ── 이 러너가 막는 구조적 hazard (sentinel-bypass) ─────────────────────────────
 * 구 dry-run 러너는 `up.sql 전문(raw) + sentinel(RAISE 'DRYRUN_OK_ABORT')` 을 한
 * 세션으로 보냈다. up.sql 본문에 top-level `COMMIT;` 이 있으면 그 COMMIT 이 sentinel
 * RAISE **이전에** 트랜잭션을 확정 → DDL 이 prod 에 영속되고, sentinel 은 커밋 뒤
 * fresh autocommit txn 에서 발화해 "무영속 PASS" 를 반환한다. 결과: 티켓
 * `mig_dryrun: pass`(영속 0 주장) ↔ prod 실재 divergence. (실증: scalp
 * T-20260712-scalp-INS-TREATMENT-PHOTO.)
 *
 * ── 3요소 정답 구조 (표준 §1 / INV-1~5) ────────────────────────────────────────
 *  ① stripTxnControl(): dollar-quote/주석/문자열 인식 lexer 로 **top-level** txn
 *     제어문(BEGIN;/COMMIT;/ROLLBACK;/END;/START TRANSACTION;) 만 제거. plpgsql 본문
 *     내부 BEGIN/END 는 보존. 제거한 문장은 stripped_statements 로 evidence 기록
 *     (침묵 제거 금지 — INV-5).
 *  ② plpgsql exception-handler 경유 실행: strip 후 up.sql 을 `DO $$ BEGIN EXECUTE
 *     <payload>; EXCEPTION WHEN OTHERS ... END $$` 안에서 동적 실행. sentinel RAISE 가
 *     implicit savepoint 롤백을 유발 = 진짜 무영속. exception-handler 블록 안에서는
 *     COMMIT/ROLLBACK 자체가 런타임 hard-fail → strip 이 놓친 obfuscated/dynamic
 *     COMMIT 도 구조적 backstop 으로 차단 (INV-2).
 *  ③ assertAbsent post-probe: dry-run 후 introspection(to_regclass·pg_policies·
 *     pg_trigger·pg_proc·information_schema)으로 대상 오브젝트 prod **부재** 실측.
 *     발견 시 즉시 FAIL(dryrun_persistence_leak), PASS 반환 금지 (INV-3).
 *
 * ── foot 전송(transport) 결정 ──────────────────────────────────────────────────
 * scalp 은 ose_execute/ose_query RPC 를 쓰지만 foot 에는 그 RPC 가 없다. foot 의
 * canonical 전송은 Supabase Management API `POST /v1/projects/{ref}/database/query`
 * (PAT=SUPABASE_ACCESS_TOKEN, .env.local). 본 러너는 그 전송 위에 동일한 3요소 구조를
 * 구현한다 — plpgsql exception-handler(DO ... EXECUTE ... EXCEPTION)가 무영속을 보장하고
 * post-probe 가 사후 부재를 실증한다.
 *
 * ── 무영속 불가 DDL (표준 §5) ──────────────────────────────────────────────────
 * CREATE INDEX CONCURRENTLY / ALTER TYPE ... ADD VALUE / VACUUM / CREATE DATABASE /
 * ALTER SYSTEM / REINDEX CONCURRENTLY 등은 트랜잭션 블록 내 실행 불가 → 롤백 봉투로
 * 검증 불가. 검출 시 NON_TXN_DDL_CANNOT_DRYRUN 로 hard-fail (절대 PASS 아님).
 * disposable fresh/shadow DB 실적용 경로로만 검증.
 *
 * usage (CLI):
 *   node scripts/dryrun_lib.mjs <path-to-up.sql> [--absent "label=SQL_returning_bool" ...]
 * usage (module):
 *   import { runDryrun, regclassAbsent, policyAbsent } from './dryrun_lib.mjs'
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REF = process.env.FOOT_SUPABASE_REF || 'rxlomoozakkjesdqjtvd';

// ── token 로드: env → .env.local → ~/.config/medibuilder-secrets/foot-supabase-pat ─
function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const env = readFileSync('.env.local', 'utf8');
    const m = env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* fall through */ }
  try {
    return readFileSync(join(homedir(), '.config/medibuilder-secrets/foot-supabase-pat'), 'utf8').trim();
  } catch { /* fall through */ }
  throw new Error('no SUPABASE_ACCESS_TOKEN (env / .env.local / ~/.config/medibuilder-secrets/foot-supabase-pat)');
}

/** Run one SQL statement/batch via the Management API. Returns parsed JSON rows. */
export async function q(sql, token = loadToken()) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
}

// ── top-level transaction-control matcher (INV-1) ────────────────────────────
// Full line, optional leading whitespace, REQUIRES terminating ';'.
// Matches: BEGIN; COMMIT; ROLLBACK; END; START TRANSACTION; BEGIN WORK; COMMIT WORK;
// Does NOT match plpgsql block keywords `BEGIN` / `END` (no ';') / `END IF;` / `END LOOP;`.
const TXN_RE = /^[ \t]*(?:BEGIN|COMMIT|ROLLBACK|END|START[ \t]+TRANSACTION|BEGIN[ \t]+WORK|COMMIT[ \t]+WORK)[ \t]*;[ \t]*$/gim;

// opening dollar-quote tag anchored at a position, e.g. $$ $preflight$ $verify$
const DOLLAR_TAG_AT = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Return list of [start, end) char spans that lie INSIDE dollar-quoted literals
 * (inclusive of the tags). A real lexer that SKIPS line/block comments and
 * single-quoted string literals so a `$tag$` mentioned inside a comment or string
 * is NOT mistaken for a dollar-quote opener (that false-pairing bug once swallowed
 * a top-level BEGIN;). — port of scalp _dollar_spans().
 */
export function dollarSpans(sql) {
  const spans = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // line comment: -- ... \n
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // block comment: /* ... */
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // single-quoted string literal: '...' with '' escape
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    // dollar-quote opener?
    if (ch === '$') {
      DOLLAR_TAG_AT.lastIndex = i;
      const m = DOLLAR_TAG_AT.exec(sql);
      if (m && m.index === i) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) { spans.push([i, n]); break; } // unterminated → rest quoted
        const end = close + tag.length;
        spans.push([i, end]);
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

function inside(pos, spans) {
  for (const [a, b] of spans) if (a <= pos && pos < b) return true;
  return false;
}

/**
 * Remove TOP-LEVEL BEGIN;/COMMIT;/ROLLBACK;/END;/START TRANSACTION; lines that are
 * OUTSIDE any dollar-quoted block. Returns { stripped, removed }. (INV-1, INV-5)
 */
export function stripTxnControl(sql) {
  const spans = dollarSpans(sql);
  const removed = [];
  const stripped = sql.replace(TXN_RE, (match, offset) => {
    if (inside(offset, spans)) return match;   // inside plpgsql body → keep verbatim
    removed.push(match.trim());
    return '';                                  // drop the line's content
  });
  return { stripped, removed };
}

// ── 무영속 불가 DDL 검출 (표준 §5) ────────────────────────────────────────────
// top-level(주석/문자열/dollar 밖)에서만 검출. plpgsql 본문 언급은 무시.
const NON_TXN_PATTERNS = [
  { code: 'CREATE_INDEX_CONCURRENTLY', re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi },
  { code: 'DROP_INDEX_CONCURRENTLY',   re: /\bDROP\s+INDEX\s+CONCURRENTLY\b/gi },
  { code: 'REINDEX_CONCURRENTLY',      re: /\bREINDEX\b[^\n;]*\bCONCURRENTLY\b/gi },
  { code: 'ALTER_TYPE_ADD_VALUE',      re: /\bALTER\s+TYPE\b[^\n;]*\bADD\s+VALUE\b/gi },
  { code: 'VACUUM',                    re: /^\s*VACUUM\b/gim },
  { code: 'CREATE_DATABASE',           re: /\bCREATE\s+DATABASE\b/gi },
  { code: 'DROP_DATABASE',             re: /\bDROP\s+DATABASE\b/gi },
  { code: 'ALTER_SYSTEM',              re: /\bALTER\s+SYSTEM\b/gi },
  { code: 'CREATE_TABLESPACE',         re: /\bCREATE\s+TABLESPACE\b/gi },
];

/** Return list of { code, stmt } for non-transactional DDL found at top level. */
export function detectNonTxnDdl(sql) {
  const spans = dollarSpans(sql);
  const found = [];
  for (const { code, re } of NON_TXN_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      if (!inside(m.index, spans)) {
        const lineStart = sql.lastIndexOf('\n', m.index) + 1;
        let lineEnd = sql.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = sql.length;
        found.push({ code, stmt: sql.slice(lineStart, lineEnd).trim() });
      }
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
    }
  }
  return found;
}

// ── sentinel + harness build ─────────────────────────────────────────────────
const SENTINEL_MSG = 'DRYRUN_OK_ABORT: all checks passed, forced rollback';

/** Pick a dollar-quote tag `$<base>N$` that does NOT appear in `text`. */
function pickTag(text, base) {
  for (let i = 0; i < 1000; i++) {
    const tag = `$${base}${i}$`;
    if (!text.includes(tag)) return tag;
  }
  throw new Error(`could not find a non-colliding dollar tag for ${base}`);
}

/**
 * Build the full harness SQL:
 *   - strip top-level txn control from up.sql (INV-1)
 *   - append a sentinel RAISE (forces rollback)
 *   - wrap the whole thing in a plpgsql DO ... EXECUTE ... EXCEPTION handler (INV-2)
 * Returns { harness, removed, sentinelTag }.
 */
export function buildHarness(upSql) {
  const { stripped, removed } = stripTxnControl(upSql);
  const sentinelTag = pickTag(stripped, 'dr_sentinel');
  const sentinel = `\nDO ${sentinelTag} BEGIN RAISE EXCEPTION '${SENTINEL_MSG}'; END ${sentinelTag};\n`;
  const payload = stripped.replace(/\s+$/, '') + sentinel;

  const bodyTag = pickTag(payload, 'dr_body');
  const harnessTag = pickTag(payload + bodyTag, 'dr_harness');
  // INV-2 / INV-4: EXECUTE the payload inside an exception handler; the sentinel
  // code is the ONLY error swallowed as a PASS candidate — every other exception
  // is re-raised so a broken migration can never be mislabeled PASS.
  const harness =
`DO ${harnessTag}
BEGIN
  EXECUTE ${bodyTag}
${payload}
  ${bodyTag};
EXCEPTION WHEN OTHERS THEN
  IF POSITION('DRYRUN_OK_ABORT' IN COALESCE(SQLERRM, '')) > 0 THEN
    RAISE NOTICE 'DRYRUN_OK_ABORT sentinel reached — subtransaction rolled back (non-persistent)';
  ELSE
    RAISE;
  END IF;
END
${harnessTag};`;
  return { harness, removed, sentinelTag };
}

// ── post-probe absence builders (INV-3) — each returns { label, sql } where
//    sql yields a single boolean TRUE when the object is ABSENT (non-persistent). ─
export const regclassAbsent = (qualified) =>
  ({ label: `relation ${qualified}`, sql: `SELECT to_regclass('${qualified}') IS NULL AS absent;` });
export const columnAbsent = (table, col, schema = 'public') =>
  ({ label: `column ${schema}.${table}.${col}`, sql:
    `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' AND column_name='${col}') AS absent;` });
export const policyAbsent = (table, policy, schema = 'public') =>
  ({ label: `policy ${policy} on ${schema}.${table}`, sql:
    `SELECT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='${schema}' AND tablename='${table}' AND policyname='${policy}') AS absent;` });
export const triggerAbsent = (trigger, table, schema = 'public') =>
  ({ label: `trigger ${trigger} on ${schema}.${table}`, sql:
    `SELECT NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schema}' AND c.relname='${table}' AND t.tgname='${trigger}' AND NOT t.tgisinternal) AS absent;` });
export const procAbsent = (proname, schema = 'public') =>
  ({ label: `proc ${schema}.${proname}`, sql:
    `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${schema}' AND p.proname='${proname}') AS absent;` });

function firstBool(rows) {
  if (Array.isArray(rows) && rows.length) {
    const v = Object.values(rows[0])[0];
    return v === true || v === 't' || v === 'true';
  }
  return false;
}

/**
 * Execute a non-persistent dry-run of `up.sql`.
 *
 * opts:
 *   upPath        path to *_up.sql (or provide upSql)
 *   upSql         raw SQL (overrides upPath read)
 *   assertAbsent  array of { label, sql } probes; each sql must return a single
 *                 boolean TRUE when the object is ABSENT. Any FALSE → FAIL.
 *   passNote      extra text printed on PASS
 *   token         override PAT
 *   exitProcess   default true — call process.exit(); set false for programmatic use
 *
 * Returns { pass, code, removed, probes } (also exits unless exitProcess=false).
 */
export async function runDryrun(opts = {}) {
  const { upPath, assertAbsent = [], passNote = '', token = loadToken(), exitProcess = true } = opts;
  const upSql = opts.upSql ?? readFileSync(upPath, 'utf8');
  const name = upPath ? basename(upPath) : '(inline sql)';

  const done = (pass, code) => {
    if (exitProcess) process.exit(pass ? 0 : (code || 1));
    return { pass, code: pass ? 0 : (code || 1) };
  };

  console.log(`== dry-run ${name} ==`);

  // 표준 §5: 무영속 불가 DDL → 절대 PASS 아님.
  const nonTxn = detectNonTxnDdl(upSql);
  if (nonTxn.length) {
    console.log('== NON_TXN_DDL_CANNOT_DRYRUN ==');
    for (const { code, stmt } of nonTxn) console.log(`   [${code}] ${stmt}`);
    console.log('무영속 dry-run 불가 DDL. disposable fresh/shadow DB 실적용 경로로 검증하라.');
    console.log('qa-fail code: non_txn_ddl_no_dryrun');
    return done(false, 3);
  }

  const { harness, removed } = buildHarness(upSql);
  console.log(`   stripped top-level txn-control (INV-5): ${removed.length ? JSON.stringify(removed) : '(none)'}`);

  // ── ② plpgsql exception-handler 실행 ──
  // 정상 경로: harness 의 EXCEPTION handler 가 sentinel 을 내부에서 삼키고 NOTICE 로
  // 강등 → q() 는 에러 없이 [] 반환. 실제 마이그 에러(비-sentinel)만 handler 가 RAISE;
  // 로 re-raise → q() throw. 따라서 **q() 가 throw 하면 = 실 마이그 에러 = FAIL** (INV-4).
  //   ⚠ 에러 메시지 문자열로 sentinel 여부를 판정하지 말 것 — API 에러 본문이 harness
  //     SQL 원문('DRYRUN_OK_ABORT' 리터럴 포함)을 echo 하므로 실 에러를 PASS 로 오분류한다
  //     (이 러너가 막으려는 sentinel-bypass 와 동형의 은폐 버그).
  let resp;
  try {
    resp = await q(harness, token);
  } catch (e) {
    console.log('\n== DRY-RUN FAIL == (마이그 실행 에러 — sentinel 미도달, handler 가 re-raise)');
    console.log('   ' + String(e.message || e));
    return done(false, 1);
  }
  console.log(`   harness response: ${JSON.stringify(resp ?? [])}`);

  // ── ③ post-probe: 무영속 실측 (INV-3) ──
  const probes = [];
  for (const { label, sql } of assertAbsent) {
    const rows = await q(sql, token);
    const absent = firstBool(rows);
    probes.push({ label, absent, raw: rows });
    console.log(`   post-probe [${label}] absent? -> ${JSON.stringify(rows)}`);
    if (!absent) {
      console.log(`\n== DRY-RUN FAIL == persistence detected: '${label}' still present after dry-run`);
      console.log('qa-fail code: dryrun_persistence_leak');
      return done(false, 2);
    }
  }
  if (!assertAbsent.length) {
    console.log('   ⚠ post-probe 미지정 — 무영속 러너는 assertAbsent 를 반드시 전달하라 (INV-3).');
    console.log('     deploy-ready 마킹 시 mig_dryrun_postprobe: absent 근거가 없으면 supervisor qa-fail.');
  }

  console.log(`\n== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent) ${passNote}`);
  return done(true, 0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const upPath = args.find((a) => !a.startsWith('--'));
  if (!upPath) {
    console.error('usage: node scripts/dryrun_lib.mjs <path-to-up.sql> [--absent "label=SQL" ...]');
    process.exit(64);
  }
  const assertAbsent = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--absent' && args[i + 1]) {
      const eq = args[i + 1].indexOf('=');
      assertAbsent.push({ label: args[i + 1].slice(0, eq), sql: args[i + 1].slice(eq + 1) });
      i++;
    }
  }
  runDryrun({ upPath, assertAbsent }).catch((e) => { console.error(e); process.exit(1); });
}

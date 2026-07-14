/**
 * T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP — Phase 0 (READ-ONLY census)
 *
 * 원장(supabase_migrations.schema_migrations) ↔ 로컬 마이그 파일 ↔ prod 실재 3자 대조.
 * foot repo가 표준 `supabase db push`가 아닌 직접 API query() runner로 DDL을 적용해온 결과,
 * 원장이 로컬 파일과 wholesale divergence. 이 census는 pending version 전수를 §2 표 분기로 분류한다.
 *
 * ⚠ HARD 제약 (본 스크립트가 스스로 강제):
 *   - 원장/DDL write 절대 0. Management API /database/query 에 SELECT/read-only introspection 만.
 *   - INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/repair/push 일절 없음.
 *   - blanket db push / db repair --all 금지 (mig289 §Q1 rename 재실행 함정 + 255 대량 재적용 파국).
 *
 * 분기 (migration_ledger_reconciliation.md §2):
 *   (F) forward-doc     = prod 물화·원장만 미기록 (verdict APPLIED, in_ledger N).
 *                         재실행 0, statements NULL, content-parity 게이트. 원장 write = supervisor exec lane.
 *   (A) ADDITIVE 재수렴 = prod 미적용·비파괴 (verdict MISSING, additive-only). 정상 apply 대상.
 *   (X) 삭제-정정       = under-materialized(DRIFT)·종이선언·파괴위험. 파일 정정·삭제, 거짓 applied 마킹 금지.
 *   (U) 수기검토        = probeable 객체 0 (순수 GRANT/data-only/COMMENT). 잠정 분기 + needs_manual.
 *
 * ball 반환: dev-foot(Phase 0 census) → planner/DA(분류표 리뷰·Phase 1 시퀀싱).
 * author: dev-foot / 2026-07-14
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../supabase/migrations');
const OUT_DIR = join(__dirname, 'audit_out');
const REF = 'rxlomoozakkjesdqjtvd';

const env = readFileSync(join(__dirname, '../.env.local'), 'utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요(.env.local)'); process.exit(1); }

// ── READ-ONLY 가드: SELECT / read-only introspection 만 허용 ──
const WRITE_RE = /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment\s+on|refresh\s+materialized|repair|call|do)\b/i;
async function q(sql) {
  if (WRITE_RE.test(sql.replace(/--[^\n]*/g, ''))) {
    throw new Error('READ-ONLY 가드 위반 — write 계열 SQL 차단: ' + sql.slice(0, 80));
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ── forward 마이그만 (rollback/down/seed-script/dryrun/datafix 제외) ──
const isForward = (f) =>
  f.endsWith('.sql') &&
  !/\.(down|rollback)\.sql$/.test(f) &&
  !/_down\.sql$/.test(f) && !/_rollback\.sql$/.test(f) &&
  !/\.dryrun\.sql$/.test(f) && !/_dryrun\.sql$/.test(f) &&
  !/^rollback_/.test(f) && !/^dedupe_/.test(f) && !/^dummy_/.test(f) &&
  !/^migrate_hfq/.test(f) && !/^visittype_/.test(f) && !/\.datafix\.sql$/.test(f);

const verOf = (f) => (f.match(/^(\d{14})/) || [])[1] || (f.match(/^(\d{8})/) || [])[1] || null;

const files = readdirSync(MIG_DIR).filter(isForward).sort();

// ── 객체 추출 (track1 sweep 재사용) ──
function extractObjects(sql) {
  const clean = sql.replace(/--[^\n]*/g, '');
  const objs = [];
  let m;
  const push = (o) => objs.push(o);

  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[a-z0-9_]+"?)\s*\(/gi;
  while ((m = fnRe.exec(clean))) push({ kind: 'function', name: m[1].replace(/"/g, '') });
  const tblRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = tblRe.exec(clean))) push({ kind: 'table', name: m[1].replace(/"/g, '') });
  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = viewRe.exec(clean))) push({ kind: 'view', name: m[1].replace(/"/g, '') });
  const typeRe = /create\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+as\s+enum/gi;
  while ((m = typeRe.exec(clean))) push({ kind: 'enum_type', name: m[1].replace(/"/g, '') });
  const colRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?[a-z0-9_]+"?)/gi;
  while ((m = colRe.exec(clean))) push({ kind: 'column', table: m[1].replace(/"/g, ''), name: m[2].replace(/"/g, '') });
  const enumValRe = /alter\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;
  while ((m = enumValRe.exec(clean))) push({ kind: 'enum_value', type: m[1].replace(/"/g, ''), name: m[2] });
  const polRe = /create\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = polRe.exec(clean))) push({ kind: 'policy', name: m[1], table: m[2].replace(/"/g, '') });
  const idxRe = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?("?[a-z0-9_]+"?)\s+on/gi;
  while ((m = idxRe.exec(clean))) push({ kind: 'index', name: m[1].replace(/"/g, '') });
  const trigRe = /create\s+(?:or\s+replace\s+)?trigger\s+("?[a-z0-9_]+"?)/gi;
  while ((m = trigRe.exec(clean))) push({ kind: 'trigger', name: m[1].replace(/"/g, '') });

  const seen = new Set();
  return objs.filter(o => { const k = JSON.stringify(o); if (seen.has(k)) return false; seen.add(k); return true; });
}

// destructive 위험 (X 분기 근거): 이미 물화(APPLIED)면 무해하나 미물화 상태 apply 시 파괴.
const destructiveOps = (sql) => {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/drop\s+(policy|trigger)\s+if\s+exists/gi, ''); // CREATE OR REPLACE 전조 무시
  const hits = [];
  if (/drop\s+table/i.test(clean)) hits.push('DROP TABLE');
  if (/drop\s+column/i.test(clean)) hits.push('DROP COLUMN');
  if (/\btruncate\b/i.test(clean)) hits.push('TRUNCATE');
  if (/delete\s+from/i.test(clean)) hits.push('DELETE');
  if (/drop\s+type/i.test(clean)) hits.push('DROP TYPE');
  if (/drop\s+function/i.test(clean) && !/drop\s+function\s+if\s+exists/i.test(clean)) hits.push('DROP FUNCTION');
  if (/alter\s+table[^;]*drop\s+constraint/i.test(clean)) hits.push('DROP CONSTRAINT');
  if (/alter\s+column[^;]*type/i.test(clean)) hits.push('ALTER COLUMN TYPE');
  return hits;
};
const isSecurity = (sql) => /create\s+policy|drop\s+policy|\bgrant\b|\brevoke\b|enable\s+row\s+level\s+security|alter\s+.*\s+force\s+row\s+level/i.test(sql.replace(/--[^\n]*/g, ''));

(async () => {
  console.log(`══ Phase 0 census (READ-ONLY) — forward files: ${files.length} ══\n`);

  // ── prod 스냅샷 (read-only bulk) ──
  const [smRows, procRows, relRows, colRows, enumRows, polRows, idxRows, trigRows] = await Promise.all([
    q(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;`).then(r => r.result ?? r).catch(() => []),
    q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';`).then(r => r.result ?? r),
    q(`SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';`).then(r => r.result ?? r),
    q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public';`).then(r => r.result ?? r),
    q(`SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid;`).then(r => r.result ?? r),
    q(`SELECT tablename, policyname FROM pg_policies WHERE schemaname='public';`).then(r => r.result ?? r),
    q(`SELECT indexname FROM pg_indexes WHERE schemaname='public';`).then(r => r.result ?? r),
    q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`).then(r => r.result ?? r),
  ]);

  const ledger = smRows || [];
  const smSet = new Set(ledger.map(r => r.version));
  const procSet = new Set(procRows.map(r => r.proname));
  const relSet = new Set(relRows.map(r => r.relname));
  const colSet = new Set(colRows.map(r => `${r.table_name}.${r.column_name}`));
  const enumSet = new Set(enumRows.map(r => `${r.typname}.${r.enumlabel}`));
  const polSet = new Set(polRows.map(r => `${r.tablename}.${r.policyname}`));
  const idxSet = new Set(idxRows.map(r => r.indexname));
  const trigSet = new Set(trigRows.map(r => r.tgname));

  const exists = (o) => {
    switch (o.kind) {
      case 'function': return procSet.has(o.name);
      case 'table': case 'view': return relSet.has(o.name);
      case 'enum_type': return relSet.has(o.name) || [...enumSet].some(k => k.startsWith(o.name + '.'));
      case 'column': return colSet.has(`${o.table}.${o.name}`);
      case 'enum_value': return enumSet.has(`${o.type}.${o.name}`);
      case 'policy': return polSet.has(`${o.table}.${o.name}`);
      case 'index': return idxSet.has(o.name);
      case 'trigger': return trigSet.has(o.name);
      default: return null;
    }
  };

  // ── 파일별 분석 ──
  const results = [];
  for (const f of files) {
    const version = verOf(f);
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    const objs = extractObjects(sql);
    const checks = objs.map(o => ({ ...o, exists: exists(o) }));
    const probeable = checks.filter(c => c.exists === true || c.exists === false);
    const present = probeable.filter(c => c.exists === true).length;
    const absent = probeable.filter(c => c.exists === false).length;
    let verdict;
    if (probeable.length === 0) verdict = 'UNKNOWN';
    else if (absent === 0) verdict = 'APPLIED';
    else if (present === 0) verdict = 'MISSING';
    else verdict = 'DRIFT';

    const destr = destructiveOps(sql);
    const in_ledger = version ? smSet.has(version) : false;

    // ── F/A/X/U 분기 ──
    let cls, reason;
    if (in_ledger) {
      cls = '—'; reason = '원장 기록됨 (pending 아님)';
    } else if (verdict === 'APPLIED') {
      cls = 'F'; reason = 'prod 물화 완료·원장만 미기록 → forward-doc (content-parity 게이트, 재실행0, statements NULL)';
    } else if (verdict === 'MISSING') {
      if (destr.length) { cls = 'X'; reason = `prod 미물화 + 파괴위험(${destr.join(',')}) → 파일 정정·삭제, 거짓 applied 금지`; }
      else { cls = 'A'; reason = 'prod 미물화·비파괴 additive → 정상 apply 대상'; }
    } else if (verdict === 'DRIFT') {
      cls = 'X'; reason = `부분물화(under-materialized: present=${present}/absent=${absent})${destr.length ? ' + 파괴위험' : ''} → 파일 정정, 거짓 applied 금지`;
    } else { // UNKNOWN
      cls = 'U'; reason = `probeable 객체 0 (순수 GRANT/data-only/COMMENT 추정)${destr.length ? ' + 파괴위험' : ''} → 수기검토, 잠정 ${destr.length ? 'X' : 'A/F'}`;
    }

    results.push({
      file: f, version, in_ledger,
      verdict, present, absent,
      destructive: destr,
      security: isSecurity(sql),
      class: cls, reason,
      needs_manual: verdict === 'UNKNOWN' || verdict === 'DRIFT',
      objects: checks,
    });
  }

  // ── collision 분석 (동일 version 2+ forward 파일) ──
  const byVer = {};
  for (const r of results) { if (!r.version) continue; (byVer[r.version] ??= []).push(r); }
  const collisions = Object.entries(byVer).filter(([, rs]) => rs.length > 1)
    .map(([v, rs]) => ({
      version: v, count: rs.length, in_ledger: rs[0].in_ledger,
      files: rs.map(r => ({ file: r.file, verdict: r.verdict, class: r.class })),
      // 처리방향: 모두 APPLIED면 forward-doc(단일 원장행 존재로 충분) / 혼재면 재부여 필요
      direction: (() => {
        const cls = new Set(rs.map(r => r.class));
        if (rs.every(r => r.verdict === 'APPLIED')) return 'ALL-APPLIED → 원장 단일행 존재로 충분(F). rename/재실행 금지(mig289 §Q1)';
        if (rs.some(r => r.verdict === 'APPLIED')) return 'MIXED → APPLIED건은 F, 미물화건은 version 재부여 후 A/X 개별 처리';
        return `NONE-APPLIED(${[...cls].join('/')}) → version 재부여 + 개별 A/X 처리`;
      })(),
    }));

  // ── 집계 ──
  const pending = results.filter(r => !r.in_ledger);
  const tally = (arr, key) => arr.reduce((a, r) => (a[r[key]] = (a[r[key]] || 0) + 1, a), {});
  const clsTally = tally(pending, 'class');
  const verdictTally = tally(pending, 'verdict');

  mkdirSync(OUT_DIR, { recursive: true });
  const outJson = join(OUT_DIR, 'T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase0_census.json');
  writeFileSync(outJson, JSON.stringify({
    generated_ticket: 'T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP',
    prod: REF,
    forward_file_count: results.length,
    ledger_row_count: ledger.length,
    pending_count: pending.length,
    class_tally: clsTally,
    verdict_tally: verdictTally,
    collision_count: collisions.length,
    collisions,
    results,
  }, null, 2));

  // ── 콘솔 요약 ──
  console.log(`forward 파일: ${results.length}   |   원장(schema_migrations) 행: ${ledger.length}   |   pending(미기록): ${pending.length}`);
  console.log(`\n── pending ${pending.length}건 §2 분기 ──`);
  console.log(`  (F) forward-doc     : ${clsTally.F || 0}`);
  console.log(`  (A) ADDITIVE 재수렴 : ${clsTally.A || 0}`);
  console.log(`  (X) 삭제-정정       : ${clsTally.X || 0}`);
  console.log(`  (U) 수기검토        : ${clsTally.U || 0}`);
  console.log(`\n── pending verdict 분포 ──`);
  for (const [k, v] of Object.entries(verdictTally)) console.log(`  ${k}: ${v}`);
  console.log(`\n── collision: ${collisions.length}건 (동일 version 2+ forward 파일) ──`);
  for (const c of collisions) {
    console.log(`  ${c.version} x${c.count} (ledger:${c.in_ledger ? 'Y' : 'N'}) [${c.files.map(f => f.verdict).join('/')}]`);
    console.log(`     → ${c.direction}`);
  }
  console.log(`\n📄 상세 JSON: scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase0_census.json`);
})();

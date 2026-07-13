/**
 * T-20260713-foot-KJY-IDENTITY-HYGIENE — auth.users FK 카탈로그 기계열거 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. DDL/DML 0. reparent/DELETE/soft-delete 일절 없음.
 *    현재 GO 아님(현장 재confirm + supervisor DB-GATE 미완). 본 스크립트는 진단 산출만.
 *
 * ref: DA CONSULT-REPLY DA-20260713-foot-KJY-ASSIGNACTION-FK-DELETE (§3)
 * 배경: gmail 계정 a7e2e012(active=false) hard-DELETE 시 PG 23503(assignment_actions_created_by_fkey, 9건)
 *       blocker. 23503은 원자 DELETE가 최초 부딪힌 FK 하나만 보고 → "9"를 전량으로 신뢰 금지.
 *       auth.users 참조 전 FK를 pg_constraint pivot로 기계열거 → gmail-id 직접 refset 전량 확정.
 *
 * 산출:
 *   AC-E1: auth.users 참조 전 FK 목록(conname·child_table·child_col·confdeltype)
 *   AC-E2: gmail-id a7e2e012 직접 참조 전량 refset(테이블·컬럼별 count)
 *   AC-E3: SET NULL/CASCADE(n/c) vs NO ACTION/RESTRICT(a/r) 분류
 *   + 정본 b36e74a3(@oblivseoul.kr) id↔email getUserById 무접점 재확인
 *
 * 실행: 관리 API database/query (SUPABASE_ACCESS_TOKEN) — read-only 사용
 *   node scripts/T-20260713-foot-KJY-IDENTITY-HYGIENE_fk-catalog.mjs
 * 산출물: scripts/out/T-20260713-KJY-IDENTITY-HYGIENE_fk-catalog.{json,md}  (gitignored)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const REF = 'rxlomoozakkjesdqjtvd';
const GMAIL_PREFIX = 'a7e2e012';       // active=false, 삭제 후보
const CANON_PREFIX = 'b36e74a3';       // 정본 @oblivseoul.kr

// --- env load (.env.local) ---
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(__dirname, '..', f);
    if (existsSync(p)) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        const m = l.match(new RegExp('^' + key + '=(.*)$'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
const SERVICE_ROLE = envVal('SUPABASE_SERVICE_ROLE_KEY');
const SUPA_URL = envVal('VITE_SUPABASE_URL');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required (.env.local)');

// --- management API SQL runner (READ-ONLY 사용) ---
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"'; // safe identifier quoting

(async () => {
  const out = { ticket: 'T-20260713-foot-KJY-IDENTITY-HYGIENE', ref: REF, at: new Date().toISOString(), acs: {} };

  // 0) full UUID 해석 (prefix → 실제 id)
  const uu = await runSQL(
    `SELECT id, email, (raw_app_meta_data->>'active') AS meta_active
     FROM auth.users
     WHERE id::text LIKE '${GMAIL_PREFIX}%' OR id::text LIKE '${CANON_PREFIX}%'
     ORDER BY id::text LIKE '${GMAIL_PREFIX}%' DESC;`
  );
  out.resolved_uuids = uu;
  const gmailRow = uu.find(r => r.id.startsWith(GMAIL_PREFIX));
  const canonRow = uu.find(r => r.id.startsWith(CANON_PREFIX));
  if (!gmailRow) throw new Error(`gmail-id ${GMAIL_PREFIX}* not found in auth.users`);
  const GMAIL_ID = gmailRow.id;
  const CANON_ID = canonRow ? canonRow.id : null;

  // === AC-E1: auth.users 참조 전 FK 기계열거 ===
  const fks = await runSQL(
    `SELECT c.conname,
            n.nspname||'.'||t.relname AS child_table,
            n.nspname AS child_schema,
            t.relname AS child_relname,
            a.attname AS child_col,
            c.confdeltype
     FROM pg_constraint c
     JOIN pg_class t ON t.oid=c.conrelid
     JOIN pg_namespace n ON n.oid=t.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
     ORDER BY child_table, c.conname;`
  );
  const DELTYPE = { a: 'NO ACTION', r: 'RESTRICT', n: 'SET NULL', c: 'CASCADE', d: 'SET DEFAULT' };
  out.acs.E1 = fks.map(f => ({ ...f, confdeltype_label: DELTYPE[f.confdeltype] || f.confdeltype }));

  // === AC-E2: gmail-id 직접 참조 전량 count (열거된 각 child_col) ===
  const counts = [];
  for (const f of fks) {
    const q = `SELECT count(*)::int AS n FROM ${ident(f.child_schema)}.${ident(f.child_relname)} WHERE ${ident(f.child_col)} = '${GMAIL_ID}';`;
    let n = null, err = null;
    try { const r = await runSQL(q); n = r[0].n; } catch (e) { err = String(e.message).slice(0, 200); }
    counts.push({ conname: f.conname, child_table: f.child_table, child_col: f.child_col,
                  confdeltype: f.confdeltype, confdeltype_label: DELTYPE[f.confdeltype] || f.confdeltype,
                  gmail_ref_count: n, error: err });
  }
  out.acs.E2 = { gmail_id: GMAIL_ID, gmail_email: gmailRow.email, per_fk: counts,
                 total_direct_refs: counts.reduce((s, c) => s + (c.gmail_ref_count || 0), 0),
                 nonzero_fks: counts.filter(c => (c.gmail_ref_count || 0) > 0) };

  // === AC-E3: deltype 분류 ===
  out.acs.E3 = {
    set_null_or_cascade: out.acs.E1.filter(f => f.confdeltype === 'n' || f.confdeltype === 'c'),   // reparent 불요·거동 확인
    no_action_or_restrict: out.acs.E1.filter(f => f.confdeltype === 'a' || f.confdeltype === 'r'),  // 함께 reparent 대상
  };

  // === 정본 b36e74a3 무접점 재확인 (getUserById via admin API) ===
  const canon = { prefix: CANON_PREFIX, sql_row: canonRow || null };
  if (SERVICE_ROLE && SUPA_URL && CANON_ID) {
    try {
      const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${CANON_ID}`, {
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      const j = await r.json();
      canon.getUserById = { status: r.status, id: j.id, email: j.email,
                            match_id: j.id === CANON_ID, match_email: j.email === (canonRow && canonRow.email) };
    } catch (e) { canon.getUserById = { error: String(e.message) }; }
  } else {
    canon.getUserById = { skipped: 'service role or canon id missing' };
  }
  out.canonical_recheck = canon;

  // --- write evidence (gitignored) ---
  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, 'T-20260713-KJY-IDENTITY-HYGIENE_fk-catalog');
  writeFileSync(base + '.json', JSON.stringify(out, null, 2));

  // markdown summary
  const L = [];
  L.push(`# T-20260713-foot-KJY-IDENTITY-HYGIENE — auth.users FK 카탈로그 (READ-ONLY)`);
  L.push(`ref: DA-20260713-foot-KJY-ASSIGNACTION-FK-DELETE §3 · ${out.at} · prod ${REF}\n`);
  L.push(`## 해석된 UUID`);
  for (const r of uu) L.push(`- \`${r.id}\` — ${r.email} (meta.active=${r.meta_active})${r.id.startsWith(GMAIL_PREFIX) ? '  ← 삭제후보(gmail)' : r.id.startsWith(CANON_PREFIX) ? '  ← 정본' : ''}`);
  L.push(`\n## AC-E1 · auth.users 참조 전 FK (${out.acs.E1.length}건)`);
  L.push(`| conname | child_table | child_col | confdeltype |`);
  L.push(`|---|---|---|---|`);
  for (const f of out.acs.E1) L.push(`| ${f.conname} | ${f.child_table} | ${f.child_col} | ${f.confdeltype} (${f.confdeltype_label}) |`);
  L.push(`\n## AC-E2 · gmail-id \`${GMAIL_ID}\` 직접 참조 전량 refset`);
  L.push(`총 직접 참조 = **${out.acs.E2.total_direct_refs}** (FK ${counts.length}개 전수 count)`);
  L.push(`| child_table | child_col | count | deltype | conname |`);
  L.push(`|---|---|---|---|---|`);
  for (const c of counts) L.push(`| ${c.child_table} | ${c.child_col} | ${c.gmail_ref_count ?? 'ERR:' + c.error} | ${c.confdeltype_label} | ${c.conname} |`);
  L.push(`\n**nonzero FK (실제 참조 보유):**`);
  if (out.acs.E2.nonzero_fks.length === 0) L.push(`- (없음)`);
  for (const c of out.acs.E2.nonzero_fks) L.push(`- ${c.child_table}.${c.child_col} = **${c.gmail_ref_count}** [${c.confdeltype_label}] (${c.conname})`);
  L.push(`\n## AC-E3 · deltype 분류`);
  L.push(`- **NO ACTION/RESTRICT (함께 reparent 대상, a/r):** ${out.acs.E3.no_action_or_restrict.map(f => f.child_table + '.' + f.child_col).join(', ') || '(없음)'}`);
  L.push(`- **SET NULL/CASCADE (reparent 불요·거동 확인, n/c):** ${out.acs.E3.set_null_or_cascade.map(f => f.child_table + '.' + f.child_col + '(' + f.confdeltype_label + ')').join(', ') || '(없음)'}`);
  L.push(`\n## 정본 재확인 (getUserById 무접점)`);
  L.push('```json'); L.push(JSON.stringify(canon, null, 2)); L.push('```');
  writeFileSync(base + '.md', L.join('\n'));

  // stdout
  console.log(L.join('\n'));
  console.log(`\n[evidence] ${base}.json / .md (gitignored)`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

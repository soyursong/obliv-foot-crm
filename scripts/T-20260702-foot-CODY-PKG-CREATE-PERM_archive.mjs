/**
 * T-20260702-foot-CODY-PKG-CREATE-PERM — ARCHIVE-FIRST 스냅샷 + ROLLBACK SQL 생성
 * ★ SELECT-only. 대상 4개 부모/자식 행 전체 컬럼 덤프 → 순소실0 보장, 롤백=재삽입.
 *
 * 대상 (deldiag 확정):
 *   public.user_profiles      WHERE id      = TARGET   (1행, app 테이블)
 *   auth.users                WHERE id      = TARGET   (1행, 부모)
 *   auth.identities           WHERE user_id = TARGET   (1행, CASCADE 자식)
 *   auth.one_time_tokens      WHERE user_id = TARGET   (1행, CASCADE 자식)
 *
 * 산출:
 *   rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_archive_20260710.json
 *   rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_rollback_20260710.sql
 */
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];
const TARGET_ID = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
const STAMP = '20260710';

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}

// value → SQL literal (jsonb 는 ::jsonb 캐스팅)
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
function insertStmt(schemaTable, row) {
  const cols = Object.keys(row);
  const vals = cols.map(c => lit(row[c]));
  return `INSERT INTO ${schemaTable} (${cols.map(c => `"${c}"`).join(', ')})\nVALUES (${vals.join(', ')});`;
}

const SOURCES = [
  { key: 'user_profiles', schemaTable: 'public.user_profiles', where: `id = '${TARGET_ID}'` },
  { key: 'auth_users', schemaTable: 'auth.users', where: `id = '${TARGET_ID}'` },
  { key: 'auth_identities', schemaTable: 'auth.identities', where: `user_id = '${TARGET_ID}'` },
  { key: 'auth_one_time_tokens', schemaTable: 'auth.one_time_tokens', where: `user_id = '${TARGET_ID}'` },
];

const archive = {
  ticket: 'T-20260702-foot-CODY-PKG-CREATE-PERM',
  purpose: '계정 영구 삭제 archive-first 스냅샷 (김주연 총괄 2026-07-10 삭제 지시, MSG-20260710-191908-wgic)',
  target: { id: TARGET_ID, email: 'kyh3858@hanmail.net', name: '김연희', crm: 'obliv-foot-crm' },
  archived_at_stamp: STAMP,
  rows: {},
};

// rollback SQL 은 FK 부모→자식 순으로 재삽입해야 함:
// auth.users → auth.identities → auth.one_time_tokens → public.user_profiles
const REINSERT_ORDER = ['auth_users', 'auth_identities', 'auth_one_time_tokens', 'user_profiles'];
const stmts = {};

for (const s of SOURCES) {
  const rows = await sql(`SELECT * FROM ${s.schemaTable} WHERE ${s.where};`);
  archive.rows[s.key] = rows;
  stmts[s.key] = rows.map(r => insertStmt(s.schemaTable, r));
  console.log(`  ${s.schemaTable}: ${rows.length}행 스냅샷`);
}

// 무결성 assert: user_profiles·auth_users 정확히 1행, id 일치
const upRows = archive.rows.user_profiles;
const auRows = archive.rows.auth_users;
if (upRows.length !== 1 || auRows.length !== 1) throw new Error('스냅샷 무결성 실패: user_profiles/auth.users ≠ 1행');
if (upRows[0].id !== TARGET_ID || auRows[0].id !== TARGET_ID) throw new Error('스냅샷 id 불일치');
if ((auRows[0].email || '').trim().toLowerCase() !== 'kyh3858@hanmail.net') throw new Error('스냅샷 email 불일치 → ABORT');

const jsonPath = `rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_archive_${STAMP}.json`;
fs.writeFileSync(jsonPath, JSON.stringify(archive, null, 2));

let sqlOut = `-- ROLLBACK (archive-first 복원): 계정 삭제 되돌리기\n`;
sqlOut += `-- 대상: ${TARGET_ID} / kyh3858@hanmail.net / 김연희\n`;
sqlOut += `-- 재삽입 순서: auth.users → auth.identities → auth.one_time_tokens → public.user_profiles (FK 부모→자식)\n`;
sqlOut += `-- ⚠ 삭제를 되돌릴 때만 실행. 정상 삭제 시 실행 금지.\nBEGIN;\n`;
for (const k of REINSERT_ORDER) {
  if (!stmts[k] || stmts[k].length === 0) continue;
  sqlOut += `\n-- ${k}\n` + stmts[k].join('\n') + '\n';
}
sqlOut += `\nCOMMIT;\n`;
const sqlPath = `rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_rollback_${STAMP}.sql`;
fs.writeFileSync(sqlPath, sqlOut);

console.log('\n✅ archive 스냅샷 →', jsonPath);
console.log('✅ rollback 재삽입 SQL →', sqlPath);
console.log('   (auth.users 1 + identities 1 + one_time_tokens 1 + user_profiles 1 = 순소실0 보존)');

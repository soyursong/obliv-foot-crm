/**
 * probe3 — end-to-end anon v3 성공 확인(valid E164, ROLLBACK) + v3 INSERT 본문 + 오버로드 전수.
 * ⚠ ROLLBACK-only. prod 영속 변경 0.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();

// v3 오버로드 전수
const ovl = await c.query(`SELECT p.oid::regprocedure AS sig, p.prosecdef, pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p WHERE p.proname='fn_selfcheckin_upsert_customer_resolve_v3' AND p.pronamespace='public'::regnamespace ORDER BY p.oid`);
console.log('── v3 오버로드 전수 ──'); console.table(ovl.rows);

// v3 INSERT 본문에서 created_by 라인 추출
const body = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE proname='fn_selfcheckin_upsert_customer_resolve_v3' AND pronamespace='public'::regnamespace LIMIT 1`);
const def = body.rows[0].def;
const idx = def.indexOf('INSERT INTO customers');
console.log('\n── v3 INSERT 블록 (created_by 스탬프 확인) ──');
console.log(def.slice(idx, idx+700));

// clinic
const clinicId = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 서울오리진점

console.log('\n── anon v3 호출 (valid E164 +821099998888, ROLLBACK) ──');
try {
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE anon');
  const r = await c.query(
    `SELECT * FROM public.fn_selfcheckin_upsert_customer_resolve_v3($1::uuid,$2::text,$3::text,$4::text)`,
    [clinicId, '__probe삭제대상__', '+821099998888', 'new']);
  console.log('   ✅ 성공 — 42501 미재현. 반환:', JSON.stringify(r.rows));
} catch (e) {
  console.log(`   결과: code=${e.code} msg="${e.message}"`);
  if (e.code === '42501') console.log('   → 42501 재현');
} finally { await c.query('ROLLBACK'); }

await c.end();
console.log('\n✅ probe3 완료 (ROLLBACK-only).');

/**
 * T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT — DIAGNOSIS (read-only)
 * RC 후보 검증:
 *  #1 clinic_id↔slug 불일치: clinics row 목록(id/slug) + jongno-foot row id
 *  #2 무음 실패(RLS/0 row): clinics UPDATE/SELECT 정책 + authenticated 권한 분석
 *  현재 laser_time_units 값 확인
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
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}\n`);

// 1) clinics rows
const rows = await client.query(`SELECT id, slug, name, laser_time_units FROM clinics ORDER BY slug`);
console.log('── clinics rows ──');
for (const r of rows.rows) {
  console.log(`  id=${r.id}  slug=${r.slug}  name=${r.name}`);
  console.log(`     laser_time_units=${JSON.stringify(r.laser_time_units)}`);
}
console.log('');

// 2) column meta
const col = await client.query(`SELECT column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema='public' AND table_name='clinics' AND column_name='laser_time_units'`);
console.log('── laser_time_units column ──');
console.log('  ', col.rows[0] ?? '(컬럼 없음!)');
console.log('');

// 3) RLS policies on clinics
const pol = await client.query(`SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='clinics' ORDER BY cmd, policyname`);
console.log('── clinics RLS 정책 ──');
const rls = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.clinics'::regclass`);
console.log('  RLS enabled:', rls.rows[0]);
for (const r of pol.rows) {
  console.log(`  [${r.cmd}] ${r.policyname}  roles=${r.roles}`);
  console.log(`        USING: ${r.qual}`);
  console.log(`        WITH CHECK: ${r.with_check}`);
}
console.log('');

// 4) grants
const grants = await client.query(`SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='clinics' AND grantee IN ('anon','authenticated') ORDER BY grantee, privilege_type`);
console.log('── table grants (anon/authenticated) ──');
for (const r of grants.rows) console.log(`  ${r.grantee}: ${r.privilege_type}`);
console.log('');

// 5) authenticated 역할로 UPDATE 시뮬레이션 (트랜잭션 → ROLLBACK)
//    실제 RLS가 authenticated UPDATE를 허용하는지 0-row 무음실패 재현
const jongno = rows.rows.find(r => r.slug === 'jongno-foot');
if (jongno) {
  console.log('── authenticated UPDATE 시뮬레이션 (ROLLBACK) ──');
  console.log(`  target jongno-foot id=${jongno.id}`);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role authenticated`);
    // RLS는 auth.uid()/auth.jwt() 기반일 수 있어 GUC 세팅
    await client.query(`SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}', true)`);
    const upd = await client.query(`UPDATE clinics SET laser_time_units = ARRAY[1,3,5,7]::int[] WHERE id=$1 RETURNING id`, [jongno.id]);
    console.log(`  → UPDATE rowCount = ${upd.rowCount}  ${upd.rowCount === 0 ? '❌ 0-row 무음실패(RLS 차단)' : '✅ 통과'}`);
    await client.query('ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`  → UPDATE 에러: ${e.message}`);
  }
}

await client.end();
console.log('\n완료.');

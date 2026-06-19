/**
 * T-20260618-foot-STAFF-CHART2-RRN-NOSAVE — PROD READ-ONLY 진단
 * 가설 확정용. 쓰기 없음 (SELECT only).
 *   1) prod rrn_decrypt 정의 drift (admin 게이트 존재 여부 = 06-15 마이그 배포 여부)
 *   2) staff profiles.clinic_id NULL/불일치
 *   3) customers.clinic_id 분포
 *   4) is_admin_or_manager / current_user_clinic_id 정의
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
console.log(`✅ PROD 연결 (READ-ONLY) ${new Date().toISOString()}\n`);

// 1) rrn_decrypt 정의 — admin 게이트 존재 여부
const fn = await client.query(
  `SELECT p.proname, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('rrn_decrypt','rrn_encrypt')`);
console.log('── (1) rrn_decrypt / rrn_encrypt prod 정의 ──');
for (const r of fn.rows) {
  const def = r.def.replace(/\s+/g,' ');
  const hasAdminGate = /is_admin_or_manager\(\)\s+THEN\s+RETURN\s+NULL/i.test(r.def) || /IF NOT public.is_admin_or_manager/i.test(r.def);
  const hasClinicGate = /current_user_clinic_id\(\)/i.test(r.def);
  const isDefiner = /SECURITY DEFINER/i.test(r.def);
  console.log(`  ${r.proname}: DEFINER=${isDefiner} adminGate=${hasAdminGate} clinicGate=${hasClinicGate}`);
}
console.log('');

// GRANT 확인
const grants = await client.query(
  `SELECT grantee, privilege_type FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name IN ('rrn_decrypt','rrn_encrypt') ORDER BY routine_name, grantee`);
console.log('── GRANT (rrn_decrypt/encrypt) ──');
for (const r of grants.rows) console.log(`  ${r.privilege_type} → ${r.grantee}`);
console.log('');

// 2) profiles role × clinic_id NULL 분포
const prof = await client.query(
  `SELECT role, count(*) AS n, count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic
     FROM profiles GROUP BY role ORDER BY role`);
console.log('── (2) profiles role × clinic_id NULL 분포 ──');
for (const r of prof.rows) console.log(`  role=${r.role}  total=${r.n}  clinic_id_NULL=${r.null_clinic}`);
console.log('');

// 3) customers clinic_id NULL + rrn_enc 존재 분포
const cust = await client.query(
  `SELECT count(*) AS n,
          count(*) FILTER (WHERE clinic_id IS NULL) AS null_clinic,
          count(*) FILTER (WHERE rrn_enc IS NOT NULL) AS has_rrn
     FROM customers`);
console.log('── (3) customers 분포 ──');
console.log(`  total=${cust.rows[0].n}  clinic_id_NULL=${cust.rows[0].null_clinic}  rrn_enc_NOT_NULL=${cust.rows[0].has_rrn}`);
console.log('');

// 4) is_admin_or_manager / current_user_clinic_id 정의 (role 매핑 확인)
const helpers = await client.query(
  `SELECT p.proname, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('is_admin_or_manager','current_user_clinic_id','is_floor_staff')`);
console.log('── (4) 헬퍼 함수 정의 ──');
for (const r of helpers.rows) {
  console.log(`  [${r.proname}]`);
  console.log('    ' + r.def.replace(/\s+/g,' ').slice(0, 400));
}
console.log('');

// 5) distinct clinic_id 목록 (단일지점 운영인지)
const clinics = await client.query(`SELECT id, slug, name FROM clinics ORDER BY created_at`).catch(()=>({rows:[]}));
console.log('── (5) clinics ──');
for (const r of clinics.rows) console.log(`  ${r.id}  slug=${r.slug}  name=${r.name}`);

await client.end();
console.log('\n✅ 진단 완료 (변경 없음)');

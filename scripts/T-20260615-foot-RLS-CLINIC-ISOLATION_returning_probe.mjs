/**
 * T-20260615-foot-RLS-CLINIC-ISOLATION — RETURNING-under-no-anon-SELECT 실증 (ROLLBACK)
 * 질문: anon SELECT 정책 제거 후 anon 의 INSERT...RETURNING 이 깨지는가?
 * 방법: 롤백 트랜잭션 안에서 anon role 임퍼스네이트 → 정책 제거 전/후 INSERT RETURNING 관찰.
 * 영속 변경 없음(끝에서 ROLLBACK).
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
console.log(`✅ PROD 연결 (ROLLBACK probe)  ${new Date().toISOString()}\n`);

const clinic = await client.query(`SELECT id, slug FROM clinics LIMIT 1`);
const cid = clinic.rows[0].id;
console.log(`clinic_id=${cid} (${clinic.rows[0].slug})`);
const tphone = '+8210' + String(Math.floor(Math.random()*1e8)).padStart(8,'0');

async function tryAnonInsertReturning(label) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(`SET LOCAL ROLE anon`);
    const r = await client.query(
      `INSERT INTO customers(clinic_id, name, phone, visit_type) VALUES ($1,'PROBE',$2,'new') RETURNING id`,
      [cid, tphone]);
    console.log(`  ${label}: INSERT RETURNING → rows=${r.rowCount} id=${r.rows[0]?.id ?? '(none)'}`);
  } catch (e) {
    console.log(`  ${label}: ERROR code=${e.code} msg=${e.message}`);
  } finally {
    await client.query(`RESET ROLE`);
    await client.query('ROLLBACK TO SAVEPOINT sp');
  }
}

try {
  await client.query('BEGIN');

  console.log('\n[1] 현재(anon SELECT 정책 존재) — INSERT RETURNING:');
  await tryAnonInsertReturning('현재');

  console.log('\n[2] anon SELECT 정책 제거 후 — INSERT RETURNING:');
  await client.query(`DROP POLICY IF EXISTS anon_select_customer_self_checkin ON customers`);
  await tryAnonInsertReturning('SELECT정책제거후');

  console.log('\n[3] anon SELECT 정책 제거 + table SELECT GRANT 회수 후 — INSERT RETURNING:');
  await client.query(`REVOKE SELECT ON customers FROM anon`);
  await tryAnonInsertReturning('SELECT회수후');

} finally {
  await client.query('ROLLBACK');
  await client.end();
  console.log('\n✅ ROLLBACK 완료 (영속 변경 0)');
}

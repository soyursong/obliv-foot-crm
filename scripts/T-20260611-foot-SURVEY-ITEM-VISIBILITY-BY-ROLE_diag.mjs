/**
 * T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE — AC-0 진단 (READ-ONLY, 직접 pg)
 *
 * 목적: 티켓 확정 RC("health_q_results RLS SELECT 정책이 admin role만 허용, 직원 role 미포함")를
 *       실제 prod DB 정책 정의로 실증/반증한다.
 *       마이그레이션(20260529000000)상 정책은 role 필터 없이 clinic_id 스코프만 보므로,
 *       prod 드리프트 여부 + 김상곤 케이스 staff/clinic_id 정합성을 함께 확인한다.
 *
 * SELECT only. prod write 절대 금지.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// ── 1. health_q_results / health_q_tokens 의 실제 RLS 정책 전체 정의 ──
for (const t of ['health_q_results', 'health_q_tokens']) {
  console.log(`\n══════ [${t}] RLS 정책 ══════`);
  const rls = await client.query(`SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1`, [t]);
  console.log(`  RLS enabled: ${rls.rows[0]?.rowsecurity}`);
  const pol = await client.query(
    `SELECT policyname, cmd, permissive, roles, qual, with_check
       FROM pg_policies WHERE schemaname='public' AND tablename=$1
       ORDER BY cmd, policyname`, [t]);
  if (pol.rowCount === 0) { console.log('  (정책 없음)'); continue; }
  for (const p of pol.rows) {
    console.log(`\n  • ${p.policyname}  [${p.cmd}] permissive=${p.permissive} roles=${JSON.stringify(p.roles)}`);
    console.log(`      USING      : ${p.qual ?? 'NULL'}`);
    console.log(`      WITH CHECK : ${p.with_check ?? 'NULL'}`);
  }
}

// ── 2. 김상곤 customer + health_q_results clinic_id ──
console.log(`\n\n══════ 김상곤 케이스 정합성 ══════`);
const cust = await client.query(
  `SELECT id, name, phone, clinic_id, chart_number FROM customers WHERE name=$1`, ['김상곤']);
console.log(`customers name=김상곤 : ${cust.rowCount}건`);
for (const c of cust.rows) {
  console.log(`  - id=${c.id} clinic_id=${c.clinic_id} chart=${c.chart_number} phone=${c.phone}`);
  const hr = await client.query(
    `SELECT id, clinic_id, form_type, submitted_at, check_in_id FROM health_q_results
       WHERE customer_id=$1 ORDER BY submitted_at DESC`, [c.id]);
  console.log(`    health_q_results: ${hr.rowCount}건`);
  for (const r of hr.rows) {
    console.log(`      • result_id=${r.id} clinic_id=${r.clinic_id} form_type=${r.form_type} submitted=${r.submitted_at?.toISOString?.() ?? r.submitted_at}`);
  }
}

// ── 3. staff 테이블: role 분포 + clinic_id (admin vs coordinator 정합성) ──
console.log(`\n\n══════ staff role 분포 ══════`);
const roles = await client.query(
  `SELECT role, count(*) AS n, count(DISTINCT clinic_id) AS clinics FROM staff GROUP BY role ORDER BY role`);
for (const r of roles.rows) console.log(`  ${r.role}: ${r.n}명 (clinic ${r.clinics}종)`);

// staff 의 user_id NULL 여부 (RLS auth.uid() 매칭 핵심)
console.log(`\n  user_id NULL 인 staff (auth.uid() 매칭 불가 → RLS 0건 원인 후보):`);
const nullu = await client.query(
  `SELECT role, count(*) AS n FROM staff WHERE user_id IS NULL GROUP BY role ORDER BY role`);
if (nullu.rowCount === 0) console.log('    (없음)');
for (const r of nullu.rows) console.log(`    ${r.role}: ${r.n}명 user_id NULL`);

// 김상곤 결과의 clinic_id 에 속한 staff 의 role별 user_id 매핑 상태
const clinicId = cust.rows[0]?.clinic_id;
if (clinicId) {
  console.log(`\n  김상곤 clinic_id=${clinicId} 소속 staff role별 user_id 보유:`);
  const sm = await client.query(
    `SELECT role, count(*) AS total, count(user_id) AS with_user
       FROM staff WHERE clinic_id=$1 GROUP BY role ORDER BY role`, [clinicId]);
  for (const r of sm.rows) console.log(`    ${r.role}: ${r.total}명 중 user_id보유 ${r.with_user}명`);
}

await client.end();
console.log('\n✅ 진단 종료 (write 없음)');

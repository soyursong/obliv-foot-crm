/**
 * T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE — AC-0 진단 2 (READ-ONLY)
 * 가설 확정: health_q_results 가 비정규(staff.user_id) 패턴 outlier 이고,
 *           나머지 환자데이터 테이블은 정규(current_user_clinic_id / user_profiles) 패턴인지.
 *           + 김상곤 clinic 의 user_profiles 신원 분포(coordinator 포함).
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
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 1. 환자데이터 핵심 테이블들의 SELECT 정책 USING 패턴 비교
console.log('══════ 환자데이터 테이블 SELECT 정책 USING 패턴 ══════');
const tabs = ['customers','check_ins','pen_charts','health_q_results','health_q_tokens','consultations','treatments'];
for (const t of tabs) {
  const pol = await client.query(
    `SELECT policyname, qual FROM pg_policies
       WHERE schemaname='public' AND tablename=$1 AND cmd='SELECT'`, [t]);
  if (pol.rowCount === 0) { console.log(`\n[${t}] SELECT 정책 없음`); continue; }
  for (const p of pol.rows) {
    const q = (p.qual||'').replace(/\s+/g,' ');
    const uses_profiles = /current_user_clinic_id|user_profiles/.test(q);
    const uses_staff = /FROM staff/.test(q);
    console.log(`\n[${t}] ${p.policyname}`);
    console.log(`   정규(user_profiles)=${uses_profiles}  비정규(staff)=${uses_staff}`);
    console.log(`   USING: ${q.slice(0,160)}`);
  }
}

// 2. 김상곤 clinic 의 user_profiles 신원 분포
const clinicId = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
console.log(`\n\n══════ user_profiles clinic_id=${clinicId} role 분포 ══════`);
const up = await client.query(
  `SELECT role, count(*) AS n, count(*) FILTER (WHERE COALESCE(active,true)) AS active_n
     FROM user_profiles WHERE clinic_id=$1 GROUP BY role ORDER BY role`, [clinicId]);
if (up.rowCount===0) console.log('  (없음)');
for (const r of up.rows) console.log(`  ${r.role}: ${r.n}명 (active ${r.active_n})`);

// 3. current_user_clinic_id() 로 김상곤 결과가 조회 가능한 user_profiles 수 (정규 패턴이면 잡히는 인원)
console.log(`\n══════ 정규 패턴 적용 시 김상곤 result 조회 가능 인원(user_profiles clinic 매칭) ══════`);
const cnt = await client.query(
  `SELECT count(*) AS n FROM user_profiles WHERE clinic_id=$1 AND COALESCE(active,true)`, [clinicId]);
console.log(`  → ${cnt.rows[0].n}명 (정규 패턴 전환 시 전원 조회 가능)`);

await client.end();
console.log('\n✅ 진단2 종료 (write 없음)');

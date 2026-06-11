/**
 * T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND — tier 모델 dry-run (READ-ONLY + TX ROLLBACK 시뮬)
 *
 * 목적 (confirm 후 AC-5 회귀검증 증거):
 *   1. packages.total_sessions 실제 분포 (tier 모델 전제 검증 — preset_12=12 등)
 *   2. 현재 package_progress_plans 레거시 행 (package1/blelabel/special)
 *   3. 마이그 시뮬레이션을 TX 안에서 실행 → 결과 plan 행 tier별 카운트 → ROLLBACK
 *   4. BEFORE/AFTER 모집단: total_sessions ∈ {6,12,..,48} active 패키지 = tier 매칭 대상
 *   5. 의도치 않은 과발동 가드: total_sessions=0(체험/Re:Born) 명시 제외 확인
 *
 * write 없음 (BEGIN ... ROLLBACK). prod 안전.
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
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const q = async (label, sql, params = []) => {
  const r = await client.query(sql, params);
  console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
  console.table(r.rows);
  return r.rows;
};

await client.connect();
console.log(`DB 연결 (READ-ONLY + TX ROLLBACK)  ${new Date().toISOString()}`);

// 1) packages.total_sessions 분포 (active) — tier 모델 전제 검증
await q('1. active packages: total_sessions 분포 (6의배수 여부)',
  `SELECT total_sessions,
          count(*) AS active_pkgs,
          (total_sessions > 0 AND total_sessions % 6 = 0) AS is_tier_eligible
   FROM packages
   WHERE status='active'
   GROUP BY total_sessions
   ORDER BY active_pkgs DESC`);

// 1b) preset_12 등 package_type별 total_sessions 교차 (전제: preset_12=12)
await q('1b. package_type × total_sessions 교차 (active)',
  `SELECT package_type, total_sessions, count(*) AS cnt
   FROM packages
   WHERE status='active'
   GROUP BY package_type, total_sessions
   ORDER BY cnt DESC
   LIMIT 25`);

// 2) 현재 레거시 plans
await q('2. 현재 package_progress_plans (레거시)',
  `SELECT clinic_id, package_type, session_milestone, label, is_active
   FROM package_progress_plans
   ORDER BY package_type, session_milestone`);

// 3) BEFORE: 현재 flag된 예약
await q('3. BEFORE — progress_check_required=true 예약',
  `SELECT count(*) AS flagged FROM reservations WHERE progress_check_required = TRUE`);

// 4) AFTER 모집단: tier 매칭 대상 active 패키지 (total_sessions 6의배수 6..48)
await q('4. AFTER 모집단 — tier(6의배수 6..48) eligible active 패키지',
  `SELECT total_sessions AS tier, count(*) AS eligible_pkgs
   FROM packages
   WHERE status='active' AND total_sessions IN (6,12,18,24,30,36,42,48)
   GROUP BY total_sessions
   ORDER BY total_sessions`);

// 5) 제외 가드: total_sessions=0 (체험/Re:Born) active 패키지 — tier 매칭에서 빠지는지
await q('5. 제외 대상 — total_sessions=0 active 패키지 (경과분석 제외)',
  `SELECT count(*) AS zero_session_pkgs
   FROM packages WHERE status='active' AND (total_sessions = 0 OR total_sessions IS NULL)`);

// 6) 마이그 시뮬레이션 (TX → ROLLBACK): 결과 plan 행 tier별 카운트
console.log('\n────────── 마이그 시뮬레이션 (BEGIN ... ROLLBACK) ──────────');
await client.query('BEGIN');
try {
  await client.query(`ALTER TABLE public.package_progress_plans ADD COLUMN IF NOT EXISTS session_count_tier INTEGER`);
  // 레거시 이관
  await client.query(`UPDATE public.package_progress_plans SET session_count_tier=12, package_type='tier_12' WHERE package_type='package1'`);
  await client.query(`UPDATE public.package_progress_plans SET session_count_tier=36, package_type='tier_36' WHERE package_type='blelabel'`);
  await client.query(`DELETE FROM public.package_progress_plans WHERE package_type='special'`);
  // 누락 tier 시드 (6,18,24,30,42,48) — clinic별
  await client.query(`
    DO $$
    DECLARE v_clinic UUID;
    BEGIN
      FOR v_clinic IN SELECT DISTINCT clinic_id FROM public.package_progress_plans LOOP
        INSERT INTO public.package_progress_plans (clinic_id, package_type, session_milestone, label, session_count_tier, notify_staff, notify_patient, is_active)
        SELECT v_clinic, 'tier_'||t.tier, m.ms,
               CASE WHEN m.ms = t.tier THEN m.ms||'회 최종 경과분석' ELSE m.ms||'회 중간 경과분석' END,
               t.tier, TRUE, FALSE, TRUE
        FROM (VALUES (6),(18),(24),(30),(42),(48)) AS t(tier)
        CROSS JOIN LATERAL generate_series(6, t.tier, 6) AS m(ms)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END $$;`);

  const sim = await client.query(
    `SELECT session_count_tier, count(*) AS plan_rows, array_agg(session_milestone ORDER BY session_milestone) AS milestones
     FROM package_progress_plans GROUP BY session_count_tier ORDER BY session_count_tier`);
  console.log('\n=== 6. 마이그 후(시뮬) plan 행 tier별 ===');
  console.table(sim.rows);

  const orphan = await client.query(
    `SELECT count(*) AS null_tier_rows FROM package_progress_plans WHERE session_count_tier IS NULL`);
  console.log('null tier 잔존 행:', orphan.rows[0].null_tier_rows);
} finally {
  await client.query('ROLLBACK');
  console.log('── ROLLBACK 완료 (DB 변경 없음) ──');
}

await client.end();
console.log('\ndry-run 완료 (write 없음).');

/**
 * T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND — AC-0 진단 (READ-ONLY, 직접 pg)
 *
 * 목적: 개선방향 1-pager 산출에 필요한 dry-run 카운트 수집.
 *   - package_templates 인벤토리
 *   - packages.package_type 분포 + template_id 커버리지
 *   - package_progress_plans 레거시 10건
 *   - 현재(before) progress_check 매칭 가능 환자 수 vs 정합 후(after) 추정
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
console.log(`DB 연결 (READ-ONLY)  ${new Date().toISOString()}`);

// 1) package_progress_plans 컬럼 구조
await q('1. package_progress_plans 컬럼',
  `SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='package_progress_plans'
   ORDER BY ordinal_position`);

// 2) package_progress_plans 전체 행 (레거시 10건)
await q('2. package_progress_plans 전체 (레거시)',
  `SELECT clinic_id, package_type, session_milestone, label, is_active
   FROM package_progress_plans
   ORDER BY package_type, session_milestone`);

// 3) package_templates 인벤토리
await q('3. package_templates 인벤토리',
  `SELECT id, clinic_id, name, heated_sessions, unheated_sessions, podologe_sessions, iv_sessions,
          (heated_sessions+unheated_sessions+podologe_sessions+iv_sessions) AS total_sessions,
          is_active, sort_order
   FROM package_templates
   ORDER BY clinic_id, sort_order, name`);

// 4) packages.package_type 분포 (status='active')
await q('4. packages.package_type 분포 (active)',
  `SELECT package_type, count(*) AS cnt,
          count(*) FILTER (WHERE template_id IS NOT NULL) AS has_template_id,
          count(*) FILTER (WHERE status='active') AS active_cnt
   FROM packages
   GROUP BY package_type
   ORDER BY cnt DESC`);

// 5) packages.template_id 커버리지 (전체)
await q('5. packages template_id 커버리지',
  `SELECT count(*) AS total_pkgs,
          count(template_id) AS with_template_id,
          count(*)-count(template_id) AS without_template_id
   FROM packages`);

// 6) package_type별 packages → 어떤 template_id로 연결되는지 (template_id 있는 것만)
await q('6. package_type ↔ template_id ↔ template.name 매핑 실태',
  `SELECT p.package_type, pt.name AS template_name, count(*) AS pkg_cnt
   FROM packages p
   LEFT JOIN package_templates pt ON pt.id = p.template_id
   WHERE p.template_id IS NOT NULL
   GROUP BY p.package_type, pt.name
   ORDER BY pkg_cnt DESC`);

// 7) BEFORE: 현재 progress_check_required=true 예약 수
await q('7. BEFORE — progress_check_required=true 예약 수 (현행)',
  `SELECT count(*) AS flagged_reservations
   FROM reservations
   WHERE progress_check_required = TRUE`);

// 8) 현 plans.package_type 값이 packages.package_type에 실제 매칭되는 건수 (왜 0인지 증거)
await q('8. plans.package_type ∩ packages.package_type 교집합',
  `SELECT pp.package_type, count(DISTINCT pk.id) AS matching_pkgs
   FROM package_progress_plans pp
   LEFT JOIN packages pk ON pk.package_type = pp.package_type
   GROUP BY pp.package_type
   ORDER BY pp.package_type`);

// 9) AFTER 추정용: 활성 패키지 중 회차 진행이 plans milestone에 도달 가능한 모집단
//    (실사용 package_type별 active package 수 — milestone 매칭 잠재 모집단)
await q('9. AFTER 모집단 — active package_type별 패키지 수',
  `SELECT package_type, count(*) AS active_pkgs
   FROM packages
   WHERE status='active'
   GROUP BY package_type
   ORDER BY active_pkgs DESC`);

await client.end();
console.log('\n진단 완료 (write 없음).');

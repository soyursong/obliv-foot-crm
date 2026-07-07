/**
 * T-20260707-foot-BILLDETAIL-CATEGORY-HARDCODE — DIAGNOSE (read-only)
 * DIAGNOSE-FIRST: services.category_label 가 HIRA 항목분류 매핑 소스로 유효한지 확인.
 *  - category_label 값 분포 (제증명 과적재 여부)
 *  - hira_code 보유 여부 × category_label 교차
 *  - 실제 청구 line-item(check_in_services→services) 에 쓰인 category_label 분포
 * 데이터 무변경.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
for (const f of ['.env', '.env.local']) {
  if (!DB_PASSWORD && fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
    }
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결 (DIAGNOSE, read-only)', new Date().toISOString(), '\n');

const q = async (label, sql) => {
  const r = await c.query(sql);
  console.log(`── ${label} ──`);
  for (const row of r.rows) console.log('  ' + JSON.stringify(row));
  console.log('');
};

await q('1) services.category_label 분포 (전체)',
  `SELECT category_label, count(*) n, sum((hira_code IS NOT NULL)::int) with_hira,
          sum((is_insurance_covered)::int) covered
   FROM services GROUP BY category_label ORDER BY n DESC`);

await q('2) category_label 에 제증명/문서-폼 그룹 값이 섞여 있나?',
  `SELECT category_label, count(*) n FROM services
   WHERE category_label ILIKE '%제증명%' OR category_label ILIKE '%영수증%'
      OR category_label ILIKE '%내역서%' OR category_label ILIKE '%처방전%'
   GROUP BY category_label`);

await q('3) 실제 청구된 line-item(check_in_services) 에 쓰인 category_label 분포',
  `SELECT s.category_label, count(*) n, sum((s.hira_code IS NOT NULL)::int) with_hira,
          sum((s.is_insurance_covered)::int) covered
   FROM check_in_services cis JOIN services s ON s.id = cis.service_id
   GROUP BY s.category_label ORDER BY n DESC`);

await q('4) 급여(is_insurance_covered) 항목의 category_label 별 hira_code 샘플',
  `SELECT s.category_label, s.name, s.service_code, s.hira_code, s.is_insurance_covered
   FROM check_in_services cis JOIN services s ON s.id = cis.service_id
   WHERE s.is_insurance_covered = true
   ORDER BY s.category_label LIMIT 25`);

await q('5) 비급여 항목 category_label 샘플',
  `SELECT DISTINCT s.category_label, s.name, s.is_insurance_covered
   FROM check_in_services cis JOIN services s ON s.id = cis.service_id
   WHERE COALESCE(s.is_insurance_covered,false) = false
   ORDER BY s.category_label LIMIT 25`);

await c.end();
console.log('✅ DIAGNOSE 완료');

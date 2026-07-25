/**
 * T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS — 1차 판정 (READ-ONLY, prod).
 *
 * 목적: 수납창에서 '공휴일 초진진찰료-의원' 항목이 비급여(면세)로 잡히는 원인이
 *   (a) services 마스터 급여/면세 플래그 config 오설정(is_insurance_covered=false / hira_code NULL) 인지
 *   (b) FE 분기(getTaxClass) 오류 인지 를 데이터로 판정한다.
 *
 * getTaxClass(footBilling.ts) 규칙 재확인:
 *   급여  ← (covered_grade && hira_code) || is_insurance_covered=true
 *   비급여(과세) ← vat_type in (exclusive, inclusive)
 *   비급여(면세) ← 그 외 전부  ← ★ 여기로 떨어짐(문제)
 *   => is_insurance_covered=true 이면 grade 무관 무조건 급여. 따라서 면세로 잡힌다 =
 *      해당 services row 가 is_insurance_covered != true 이고 hira_code 도 없다는 뜻(가설 a).
 *
 * READ-ONLY: SELECT 만. 어떤 쓰기도 하지 않는다.
 */
import { readFileSync } from 'node:fs';

const MGMT = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd'; // 풋센터 prod

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const T = (rows) => {
  if (!rows.length) { console.log('  (0 rows)'); return; }
  for (const row of rows) console.log('  ' + JSON.stringify(row));
};

console.log('=== [1] 진찰료성/공휴일/초진 서비스 마스터 플래그 ===');
T(await q(`
  SELECT id, name, service_code, hira_code, hira_category, hira_score,
         is_insurance_covered, vat_type, category_label, price, active
  FROM services
  WHERE name ILIKE '%진찰료%' OR name ILIKE '%공휴일%' OR name ILIKE '%초진%' OR name ILIKE '%재진%' OR name ILIKE '%상담%'
  ORDER BY name;
`));

console.log('\n=== [2] getTaxClass 시뮬레이션 (is_insurance_covered 기준, grade 무관) ===');
T(await q(`
  SELECT name,
         CASE
           WHEN is_insurance_covered IS TRUE THEN '급여'
           WHEN vat_type IN ('exclusive','inclusive') THEN '비급여(과세)'
           ELSE '비급여(면세)'
         END AS tax_class_no_grade,
         is_insurance_covered, hira_code, vat_type
  FROM services
  WHERE name ILIKE '%진찰료%' OR name ILIKE '%공휴일%' OR name ILIKE '%초진%' OR name ILIKE '%재진%'
  ORDER BY name;
`));

console.log('\n=== [3] 정상 급여 진찰료(대조군) — 이미 급여로 잡히는 진찰료 항목과 플래그 비교 ===');
T(await q(`
  SELECT name, is_insurance_covered, hira_code, hira_score, hira_category, vat_type
  FROM services
  WHERE (name ILIKE '%진찰료%' OR name ILIKE '%초진%' OR name ILIKE '%재진%')
    AND is_insurance_covered IS TRUE
  ORDER BY name;
`));

console.log('\n=== [4] 문제 항목 정밀 조회: 공휴일 초진진찰료-의원 ===');
T(await q(`
  SELECT id, name, service_code, hira_code, hira_category, hira_score,
         is_insurance_covered, vat_type, category_label, price, active, created_at, updated_at
  FROM services
  WHERE name ILIKE '%공휴일%초진%' OR name ILIKE '%공휴일 초진진찰료%'
  ORDER BY name;
`));

console.log('\nDONE.');

/**
 * T-20260723-foot-INSCONSULT-WRITEPATH-HIRACAT-NULL — READ-ONLY 진단 probe.
 *
 * 목적: 활성 진찰료/처치 항목의 hira_category=NULL 로 인해 원자 write-path
 *   (record_insurance_consult_payment, PMW 필터 hira_category==='consultation')가
 *   발화하지 않고, 매출 급여칸 write 가 snapshot 폴백(snapshotCoveredServiceCharges,
 *   calculation_engine_version='pmw_checkout_snapshot_v1')로 흐르는 실태를 정량화.
 *
 * 매출 split 정합 관점(revenue_insurance_split SSOT / DA 소유) 핵심 divergence 축:
 *   - 명세 grain(service_charges): 폴백이 공단부담/본인부담/base 를 적재 → 공단부담(§2-2) 보존 여부
 *   - 수납 grain(payments): 폴백 경로의 진찰료 copay 는 service_charge_id FK 미링크 +
 *     tax_type NULL 로 plain 삽입 → §2-1 v1.6 "급여 귀속=service_charge_id FK" 축에서
 *     급여 본인부담이 payment grain 상 비급여/면세로 오귀속되는지.
 *
 * READ-ONLY (SELECT only). 원장 무접점. DDL/DML 0건.
 * 판정(divergence 실질오차 여부)은 DA 소관 — 본 probe 는 evidence(fact)만 산출.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 1) 활성 급여 서비스의 hira_category 분포 (관측 재현: consultation 이 실제 세팅돼 있는가?)
out.q1_covered_services_hiracat = await q(`
  SELECT COALESCE(hira_category, '(NULL)') AS hira_category,
         COUNT(*) AS n,
         COUNT(*) FILTER (WHERE active) AS n_active,
         array_agg(service_code ORDER BY service_code)
           FILTER (WHERE active) AS active_codes
  FROM services
  WHERE is_insurance_covered = TRUE
  GROUP BY COALESCE(hira_category, '(NULL)')
  ORDER BY n DESC;
`);

// 1b) consultation 으로 세팅된 활성 급여 서비스가 하나라도 있는가 (원자 경로 발화 가능성)
out.q1b_consultation_active = await q(`
  SELECT id, service_code, name, hira_category, hira_score, active
  FROM services
  WHERE is_insurance_covered = TRUE AND hira_category = 'consultation'
  ORDER BY service_code;
`);

// 2) service_charges 를 calculation_engine_version 별로 집계 (원자 vs 폴백 write 실적)
out.q2_service_charges_by_engine = await q(`
  SELECT COALESCE(calculation_engine_version, '(NULL)') AS engine,
         COUNT(*) AS rows,
         COUNT(DISTINCT check_in_id) AS check_ins,
         SUM(base_amount)              AS sum_base,
         SUM(copayment_amount)         AS sum_copay,
         SUM(insurance_covered_amount) AS sum_covered_gongdan,
         MIN(calculated_at) AS first_at,
         MAX(calculated_at) AS last_at
  FROM service_charges
  WHERE is_insurance_covered = TRUE
  GROUP BY COALESCE(calculation_engine_version, '(NULL)')
  ORDER BY rows DESC;
`);

// 3) 폴백 경로 service_charge 중 링크된 payment 가 있는가?
//    (원자 경로면 payments.service_charge_id FK 존재, 폴백이면 부재 예상)
out.q3_charge_payment_linkage = await q(`
  SELECT sc.calculation_engine_version AS engine,
         COUNT(*) AS charges,
         COUNT(p.id) AS charges_with_linked_payment,
         COUNT(*) - COUNT(p.id) AS charges_without_linked_payment
  FROM service_charges sc
  LEFT JOIN payments p ON p.service_charge_id = sc.id
  WHERE sc.is_insurance_covered = TRUE
  GROUP BY sc.calculation_engine_version
  ORDER BY charges DESC;
`);

// 4) payments 의 service_charge_id FK 채움율 + tax_type 분포
//    (§2-1 v1.6 급여 귀속축=FK. FK NULL + tax_type NULL = payment grain 상 면세/비급여 오귀속 후보)
out.q4_payments_fk_taxtype = await q(`
  SELECT (service_charge_id IS NOT NULL) AS has_fk,
         COALESCE(tax_type, '(NULL)') AS tax_type,
         COUNT(*) AS n,
         SUM(amount) AS sum_amount
  FROM payments
  WHERE payment_type = 'payment'
  GROUP BY (service_charge_id IS NOT NULL), COALESCE(tax_type, '(NULL)')
  ORDER BY has_fk DESC, n DESC;
`);

// 5) 급여 명세가 있는 방문(check_in)에서, 그 방문의 copay 총액이 payment grain 에
//    FK 링크로 잡히는지 vs plain(FK NULL) 로 흩어지는지 방문 단위 대조 (최근 60일).
out.q5_visit_grain_divergence = await q(`
  WITH covered_visits AS (
    SELECT DISTINCT check_in_id
    FROM service_charges
    WHERE is_insurance_covered = TRUE
  ),
  per_visit AS (
    SELECT cv.check_in_id,
           (SELECT SUM(sc.copayment_amount) FROM service_charges sc
              WHERE sc.check_in_id = cv.check_in_id AND sc.is_insurance_covered = TRUE) AS charge_copay,
           (SELECT COALESCE(SUM(p.amount),0) FROM payments p
              WHERE p.service_charge_id IN
                 (SELECT id FROM service_charges sc2 WHERE sc2.check_in_id = cv.check_in_id)) AS linked_payment_amt,
           (SELECT COUNT(*) FROM payments p2
              WHERE p2.check_in_id = cv.check_in_id AND p2.service_charge_id IS NULL
                AND p2.payment_type = 'payment') AS plain_payments
    FROM covered_visits cv
  )
  SELECT COUNT(*) AS covered_visits,
         COUNT(*) FILTER (WHERE linked_payment_amt = 0) AS visits_zero_linked_payment,
         COUNT(*) FILTER (WHERE linked_payment_amt = 0 AND charge_copay > 0) AS visits_copay_charged_but_no_linked_pay,
         SUM(charge_copay) AS total_charge_copay,
         SUM(linked_payment_amt) AS total_linked_payment
  FROM per_visit;
`);

console.log(JSON.stringify(out, null, 2));

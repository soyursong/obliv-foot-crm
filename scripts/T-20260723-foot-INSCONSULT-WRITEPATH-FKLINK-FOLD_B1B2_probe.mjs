/**
 * T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD — STEP 0 read-only 스코핑 probe.
 *
 * B1 (§2-2-4 판정2, grade-null 공단 phantom 체크):
 *   covered 6방문의 customer_grade_at_charge / copayment_rate_at_charge 실측.
 *   grade=NULL 인데 폴백이 공단(insurance_covered_amount>0)을 확정 적재했으면
 *   §2-2-4 판정2 위반(phantom 공단·clawback 방향) = live 리스크.
 *   기대: 폴백은 data_incomplete=true(자격/수가 미비) 행을 skip(금액 날조 금지, PMW L1886)
 *   → grade 확정 행만 적재됐어야 함.
 *
 * B2 (payments-FK 축 live 여부, DA 회신 인자):
 *   수납수단별 급여 열이 읽는 소스(tax_type='급여') payments 실적 확인.
 *   tax_type='급여' 건수=0 이면 급여 열 전부 0 표시 → live 과소 아님(going-forward 봉합만).
 *
 * READ-ONLY (SELECT only). 원장 무접점. DDL/DML 0건.
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

// B1-1) covered service_charges 6방문 grade/rate 실측 (방문·명세 단위 상세)
out.b1_1_grade_per_charge = await q(`
  SELECT check_in_id,
         COALESCE(customer_grade_at_charge, '(NULL)') AS grade_at_charge,
         copayment_rate_at_charge,
         base_amount,
         copayment_amount,
         insurance_covered_amount AS gongdan,
         ROUND(100.0 * copayment_amount / NULLIF(base_amount,0), 1)      AS copay_pct,
         ROUND(100.0 * insurance_covered_amount / NULLIF(base_amount,0), 1) AS gongdan_pct,
         calculation_engine_version AS engine
  FROM service_charges
  WHERE is_insurance_covered = TRUE
  ORDER BY check_in_id, base_amount DESC;
`);

// B1-2) phantom 공단 판정: grade=NULL 인데 공단>0 인 행 (§2-2-4 판정2 위반 후보)
out.b1_2_phantom_gongdan = await q(`
  SELECT COUNT(*) AS covered_charges,
         COUNT(*) FILTER (WHERE customer_grade_at_charge IS NULL) AS grade_null_charges,
         COUNT(*) FILTER (WHERE customer_grade_at_charge IS NULL
                            AND insurance_covered_amount > 0) AS grade_null_with_gongdan,
         COUNT(*) FILTER (WHERE customer_grade_at_charge IS NULL
                            AND copayment_rate_at_charge IS NULL) AS grade_null_rate_null,
         COUNT(DISTINCT customer_grade_at_charge) AS distinct_grades,
         array_agg(DISTINCT COALESCE(customer_grade_at_charge,'(NULL)')) AS grades_seen,
         array_agg(DISTINCT copayment_rate_at_charge)                    AS rates_seen
  FROM service_charges
  WHERE is_insurance_covered = TRUE;
`);

// B2-1) 수납수단별 급여 열 소스 = tax_type='급여' payments 실적 (0건이면 급여 열 전부 0)
out.b2_1_taxtype_gubun = await q(`
  SELECT COALESCE(tax_type, '(NULL)') AS tax_type,
         COUNT(*) AS n,
         SUM(amount) AS sum_amount
  FROM payments
  WHERE payment_type = 'payment'
  GROUP BY COALESCE(tax_type, '(NULL)')
  ORDER BY n DESC;
`);

// B2-2) service_charge_id FK 로 링크된 급여 payment (payments-FK 축 실적)
out.b2_2_fk_linked_covered_payments = await q(`
  SELECT COUNT(*) AS payments_with_charge_fk,
         COUNT(*) FILTER (WHERE sc.is_insurance_covered = TRUE) AS fk_to_covered_charge,
         COALESCE(SUM(p.amount) FILTER (WHERE sc.is_insurance_covered = TRUE),0) AS sum_covered_fk_pay
  FROM payments p
  LEFT JOIN service_charges sc ON sc.id = p.service_charge_id
  WHERE p.payment_type = 'payment' AND p.service_charge_id IS NOT NULL;
`);

console.log(JSON.stringify(out, null, 2));

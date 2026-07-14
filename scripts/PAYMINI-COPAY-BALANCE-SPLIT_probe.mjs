/**
 * T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT — READ-ONLY 현장 divergence 진단 probe.
 * 목적: 오늘 급여 방문의 service_charges(본인/공단 split) + customers.insurance_grade 상태를 조회해
 *   "수납잔액=공단 포함(자부담≠8,900)" RC 를 데이터로 특정. READ-ONLY(SELECT only).
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

// 1) service_charges 컬럼 존재 확인 (insurance_covered_amount / copayment_amount / customer_grade_at_charge)
out.sc_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='service_charges'
    AND column_name IN ('copayment_amount','insurance_covered_amount','customer_grade_at_charge','is_insurance_covered','amount','check_in_id')
  ORDER BY column_name;
`);

// 2) 오늘(KST) 급여 방문 service_charges 집계 — check_in 별 본인/공단/총 + 고객 등급
out.today_covered = await q(`
  WITH sc AS (
    SELECT s.check_in_id,
           SUM(CASE WHEN s.is_insurance_covered THEN COALESCE(s.amount,0) ELSE 0 END) AS covered_total,
           SUM(CASE WHEN s.is_insurance_covered THEN COALESCE(s.copayment_amount,0) ELSE 0 END) AS copay_sum,
           SUM(CASE WHEN s.is_insurance_covered THEN COALESCE(s.insurance_covered_amount,0) ELSE 0 END) AS nhis_sum,
           SUM(CASE WHEN NOT s.is_insurance_covered THEN COALESCE(s.amount,0) ELSE 0 END) AS noncovered_total,
           MAX(s.customer_grade_at_charge) AS grade_at_charge,
           bool_or(s.is_insurance_covered) AS has_covered
    FROM service_charges s
    GROUP BY s.check_in_id
  )
  SELECT sc.check_in_id, ci.customer_id, c.name AS cust_name,
         c.insurance_grade AS cust_grade_live, sc.grade_at_charge,
         sc.covered_total, sc.copay_sum, sc.nhis_sum, sc.noncovered_total,
         (sc.copay_sum + sc.noncovered_total) AS expected_payable,
         (sc.covered_total + sc.noncovered_total) AS full_incl_nhis,
         ci.checked_in_at
  FROM sc
  JOIN check_ins ci ON ci.id = sc.check_in_id
  LEFT JOIN customers c ON c.id = ci.customer_id
  WHERE sc.has_covered
    AND ci.checked_in_at >= (now() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul' - interval '2 days'
  ORDER BY ci.checked_in_at DESC
  LIMIT 30;
`);

// 3) 8,900 자부담 케이스 직접 탐색 (copay 또는 payable 이 8900 근방)
out.case_8900 = await q(`
  SELECT s.check_in_id, ci.customer_id, c.name, c.insurance_grade,
         s.service_name, s.amount, s.is_insurance_covered, s.copayment_amount,
         s.insurance_covered_amount, s.customer_grade_at_charge, s.created_at
  FROM service_charges s
  JOIN check_ins ci ON ci.id = s.check_in_id
  LEFT JOIN customers c ON c.id = ci.customer_id
  WHERE s.copayment_amount = 8900
     OR s.created_at::date = (now() AT TIME ZONE 'Asia/Seoul')::date
  ORDER BY s.created_at DESC
  LIMIT 40;
`);

console.log(JSON.stringify(out, null, 2));

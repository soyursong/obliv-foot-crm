/**
 * T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD — B1 READ-ONLY probe.
 *
 * B1: covered 방문의 service_charges.customer_grade_at_charge 실측 →
 *   grade-null(=unverified) 인데 공단(insurance_covered_amount)>0 확정 적재 = §2-2-4 판정2 위반
 *   (phantom 공단 / clawback 방향) live 리스크 여부 확정.
 *
 * 근거(코드): calc_copayment v1.6 는 grade NULL → COALESCE 'unverified' → ELSE 30% 분기 →
 *   insurance_covered_amount = base - copay (≈70% 공단) 를 data_incomplete=false 로 반환.
 *   snapshotCoveredServiceCharges 폴백은 이 값을 zeroing 없이 그대로 INSERT (원자 RPC W5 와 달리).
 *   → grade='unverified' + insurance_covered_amount>0 인 pmw_checkout_snapshot_v1 행 = phantom 공단.
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

// B1-1) covered service_charges: 행별 grade + 공단 + engine (phantom 후보 직접 노출)
out.b1_1_covered_rows = await q(`
  SELECT id, check_in_id, customer_id,
         COALESCE(customer_grade_at_charge,'(NULL)') AS grade_at_charge,
         base_amount, copayment_amount, insurance_covered_amount, exempt_amount,
         copayment_rate_at_charge,
         calculation_engine_version AS engine,
         calculated_at
  FROM service_charges
  WHERE is_insurance_covered = TRUE
  ORDER BY calculated_at;
`);

// B1-2) grade별 phantom 집계: unverified/NULL 인데 공단>0 = 위반 후보
out.b1_2_phantom_agg = await q(`
  SELECT COALESCE(customer_grade_at_charge,'(NULL)') AS grade_at_charge,
         calculation_engine_version AS engine,
         COUNT(*) AS rows,
         COUNT(*) FILTER (WHERE insurance_covered_amount > 0) AS rows_with_gongdan,
         SUM(insurance_covered_amount) AS sum_gongdan,
         SUM(copayment_amount) AS sum_copay
  FROM service_charges
  WHERE is_insurance_covered = TRUE
  GROUP BY COALESCE(customer_grade_at_charge,'(NULL)'), calculation_engine_version
  ORDER BY rows DESC;
`);

// B1-3) 해당 방문 고객의 현재 insurance_grade (customers 원본) — 확정 등급 존재 여부 대조
out.b1_3_customer_grade_now = await q(`
  SELECT c.id AS customer_id,
         COALESCE(c.insurance_grade,'(NULL)') AS insurance_grade_now,
         COUNT(sc.id) AS covered_charges,
         SUM(sc.insurance_covered_amount) AS sum_gongdan
  FROM customers c
  JOIN service_charges sc ON sc.customer_id = c.id AND sc.is_insurance_covered = TRUE
  GROUP BY c.id, COALESCE(c.insurance_grade,'(NULL)')
  ORDER BY covered_charges DESC;
`);

// B1-4) 라이브 전체 grade-null 관측률 참고 (parent PMW 리포트 89% 관측 재현)
out.b1_4_customers_grade_dist = await q(`
  SELECT COALESCE(insurance_grade,'(NULL)') AS insurance_grade,
         COUNT(*) AS n
  FROM customers
  GROUP BY COALESCE(insurance_grade,'(NULL)')
  ORDER BY n DESC;
`);

console.log(JSON.stringify(out, null, 2));

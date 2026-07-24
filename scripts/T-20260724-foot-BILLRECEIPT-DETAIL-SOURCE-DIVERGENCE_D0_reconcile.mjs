/**
 * T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE — D0 GATE (BLOCKING, READ-ONLY).
 *
 * billing-reconcile 선행: F-4790 방문의 check_in_services(라이브 SSOT) vs service_charges(감사로그/stale)
 *   vs payments(수납원장) 3원 대조. 315,000 vs 240,000 실제 청구·수납액 확정.
 *   실측이 codex GO(정답 소스=check_in_services)와 어긋나면 즉시 착수 중단(planner FOLLOWUP).
 *
 * READ-ONLY(SELECT only). management API(service-role, RLS bypass) 컨텍스트 명시.
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

// 0) F-4790 차트 → customer_id → 대상 check_in(들). 최근 방문 우선.
out.chart = await q(`
  SELECT c.id AS customer_id, c.chart_number, c.name, c.insurance_grade
  FROM customers c
  WHERE c.chart_number = 'F-4790'
  LIMIT 5;
`);

const custId = out.chart?.[0]?.customer_id ?? null;
out.customer_id = custId;

if (custId) {
  // 대상 방문(들)
  out.checkins = await q(`
    SELECT ci.id AS check_in_id, ci.checked_in_at, ci.status
    FROM check_ins ci
    WHERE ci.customer_id = '${custId}'
    ORDER BY ci.checked_in_at DESC
    LIMIT 10;
  `);

  // 1) check_in_services (라이브 SSOT) — service join 으로 급여/비급여·가격.
  out.check_in_services = await q(`
    SELECT cis.check_in_id,
           SUM(COALESCE(cis.price,0)) AS cis_total,
           SUM(CASE WHEN s.is_insurance_covered THEN COALESCE(cis.price,0) ELSE 0 END) AS cis_covered,
           SUM(CASE WHEN NOT s.is_insurance_covered THEN COALESCE(cis.price,0) ELSE 0 END) AS cis_noncovered,
           COUNT(*) AS n_rows
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
    LEFT JOIN services s ON s.id = cis.service_id
    WHERE ci.customer_id = '${custId}'
    GROUP BY cis.check_in_id;
  `);

  // 2) service_charges (감사로그/stale)
  out.service_charges = await q(`
    SELECT sc.check_in_id,
           SUM(COALESCE(sc.base_amount, 0)) AS sc_total,
           SUM(CASE WHEN sc.is_insurance_covered THEN COALESCE(sc.base_amount,0) ELSE 0 END) AS sc_covered,
           SUM(CASE WHEN NOT sc.is_insurance_covered THEN COALESCE(sc.base_amount,0) ELSE 0 END) AS sc_noncovered,
           SUM(COALESCE(sc.copayment_amount,0)) AS sc_copay,
           SUM(COALESCE(sc.insurance_covered_amount,0)) AS sc_nhis,
           COUNT(*) AS n_rows
    FROM service_charges sc
    JOIN check_ins ci ON ci.id = sc.check_in_id
    WHERE ci.customer_id = '${custId}'
    GROUP BY sc.check_in_id;
  `);

  // 3) payments (수납원장)
  out.payments = await q(`
    SELECT p.check_in_id, p.status, p.payment_type, p.method,
           SUM(COALESCE(p.amount,0)) AS pay_total, COUNT(*) AS n_rows
    FROM payments p
    JOIN check_ins ci ON ci.id = p.check_in_id
    WHERE ci.customer_id = '${custId}'
    GROUP BY p.check_in_id, p.status, p.payment_type, p.method
    ORDER BY p.check_in_id;
  `);
}

console.log(JSON.stringify(out, null, 2));

/**
 * T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT — 항목 ⑤ READ-ONLY 데이터 완전성 probe.
 * 목적: 라이브 obliv-foot-crm DB 가 foot 결제건 중 '할부 비중'(할부 건수/비율, 개월수 분포) 집계 가능한지 확인.
 * 경계: SELECT only. impl(①②③④)·protocol.ts 무접촉. HOLD 무관.
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

// 1) installment 컬럼 실재 확인 (payments + package_payments)
out.cols = await q(`
  SELECT table_name, column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name='installment'
    AND table_name IN ('payments','package_payments')
  ORDER BY table_name;
`);

// 2) payments(단건) — 카드 결제 전체 대비 할부 분포 (payment_type='payment', 환불 제외)
out.payments_dist = await q(`
  SELECT
    COUNT(*)                                                   AS card_pay_rows,
    COUNT(*) FILTER (WHERE COALESCE(installment,0) >= 2)       AS halbu_rows,
    COUNT(*) FILTER (WHERE COALESCE(installment,0) < 2)        AS ilsibul_rows,
    COUNT(*) FILTER (WHERE installment IS NULL)                AS installment_null_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(installment,0) >= 2)
          / NULLIF(COUNT(*),0), 2)                             AS halbu_pct
  FROM payments
  WHERE method='card' AND COALESCE(payment_type,'payment')='payment';
`);

// 3) payments — 개월수 분포
out.payments_month_dist = await q(`
  SELECT COALESCE(installment,0) AS months, COUNT(*) AS rows
  FROM payments
  WHERE method='card' AND COALESCE(payment_type,'payment')='payment'
  GROUP BY 1 ORDER BY 1;
`);

// 4) package_payments — 카드 결제 대비 할부 분포
out.pkg_dist = await q(`
  SELECT
    COUNT(*)                                                   AS card_pay_rows,
    COUNT(*) FILTER (WHERE COALESCE(installment,0) >= 2)       AS halbu_rows,
    COUNT(*) FILTER (WHERE COALESCE(installment,0) < 2)        AS ilsibul_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(installment,0) >= 2)
          / NULLIF(COUNT(*),0), 2)                             AS halbu_pct
  FROM package_payments
  WHERE method='card' AND COALESCE(payment_type,'payment')='payment';
`);

// 5) 결합(payments + package_payments) 카드결제 전체 할부 비중
out.combined = await q(`
  WITH u AS (
    SELECT COALESCE(installment,0) AS m FROM payments
      WHERE method='card' AND COALESCE(payment_type,'payment')='payment'
    UNION ALL
    SELECT COALESCE(installment,0) FROM package_payments
      WHERE method='card' AND COALESCE(payment_type,'payment')='payment'
  )
  SELECT COUNT(*) AS card_pay_rows,
         COUNT(*) FILTER (WHERE m>=2) AS halbu_rows,
         ROUND(100.0*COUNT(*) FILTER (WHERE m>=2)/NULLIF(COUNT(*),0),2) AS halbu_pct
  FROM u;
`);

// 6) 데이터 규모 sanity — 결제 총건수(방식 무관) + 카드 비중 + 최근/최초 결제시각
out.scale = await q(`
  SELECT
    (SELECT COUNT(*) FROM payments)                                    AS payments_all,
    (SELECT COUNT(*) FROM payments WHERE method='card')               AS payments_card,
    (SELECT COUNT(*) FROM package_payments)                           AS pkg_all,
    (SELECT COUNT(*) FROM package_payments WHERE method='card')       AS pkg_card,
    (SELECT MIN(created_at) FROM payments)                            AS payments_first,
    (SELECT MAX(created_at) FROM payments)                            AS payments_last;
`);

console.log(JSON.stringify(out, null, 2));

/**
 * T-20260717-foot-F4857-REFUND-MISENTRY-MISU-FIX — READ-ONLY forensic probe.
 * 목적: 엘런(F-4857) 수납 원장 전량 SELECT → 미수 500,000 산식 규명 + 반영 전 스냅샷 evidence.
 * READ-ONLY (SELECT only). 어떤 write 도 하지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

// 1) F-4857 고객 식별 (chart_number)
out.customer = await q(`
  SELECT id, name, chart_number, clinic_id, created_at
  FROM public.customers
  WHERE chart_number ILIKE '%4857%'
  ORDER BY created_at DESC;
`);

const cust = out.customer[0];
if (!cust) { console.log(JSON.stringify(out, null, 2)); console.error('!! F-4857 고객 미발견'); process.exit(2); }
const cid = cust.id;

// 2) payments 원장 전량 (진료비/단건 grain) — payments 는 fee_kind 없음, soft-delete/status 有
out.payments = await q(`
  SELECT id, check_in_id, customer_id, amount, method, installment,
         payment_type, status, deleted_at, delete_reason,
         cancelled_at, cancel_reason, parent_payment_id, linked_payment_id,
         memo, created_at
  FROM public.payments
  WHERE customer_id = '${cid}'
  ORDER BY created_at;
`);

// 3) package_payments 원장 전량 (패키지 grain)
out.package_payments = await q(`
  SELECT pp.id, pp.package_id, pp.customer_id, pp.amount, pp.method, pp.installment,
         pp.payment_type, pp.fee_kind, pp.memo, pp.created_at
  FROM public.package_payments pp
  WHERE pp.customer_id = '${cid}'
  ORDER BY pp.created_at;
`);

// 4) packages (미수 파생 소스: total_amount/consultation_fee/paid_amount/status)
out.packages = await q(`
  SELECT id, customer_id, clinic_id, total_amount, consultation_fee, paid_amount,
         total_sessions, status, created_at
  FROM public.packages
  WHERE customer_id = '${cid}'
  ORDER BY created_at;
`);

// 5) 미수 산식 재현 — footBilling.ts loadCustomerOutstanding 로직 미러
//    packageDue = total_amount − Σ(package payment − refund, fee_kind='package')
//    consultDue = consultation_fee − Σ(fee_kind='consultation')
out.outstanding_derived = await q(`
  WITH act AS (
    SELECT id, total_amount, consultation_fee, status FROM public.packages
    WHERE customer_id='${cid}' AND status='active'
  ), pp AS (
    SELECT package_id,
      SUM(CASE WHEN COALESCE(fee_kind,'package')='package'
               THEN CASE WHEN payment_type='refund' THEN -amount ELSE amount END ELSE 0 END) AS net_pkg,
      SUM(CASE WHEN fee_kind='consultation'
               THEN CASE WHEN payment_type='refund' THEN -amount ELSE amount END ELSE 0 END) AS net_consult
    FROM public.package_payments
    WHERE package_id IN (SELECT id FROM act)
    GROUP BY package_id
  )
  SELECT a.id AS package_id, a.total_amount, a.consultation_fee,
         COALESCE(pp.net_pkg,0) AS net_pkg_paid,
         COALESCE(pp.net_consult,0) AS net_consult_paid,
         GREATEST(a.total_amount - COALESCE(pp.net_pkg,0),0) AS pkg_due,
         GREATEST(a.consultation_fee - COALESCE(pp.net_consult,0),0) AS consult_due
  FROM act a LEFT JOIN pp ON pp.package_id=a.id;
`);

// 6) payments grain 순액 (진료비 미수 별도 경로 확인)
out.payments_net = await q(`
  SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net_payments,
         COUNT(*) AS n
  FROM public.payments WHERE customer_id='${cid}';
`);

// 7) source_split / insurance_split 불변 실증용 baseline
out.split_baseline = {
  package_payments_by_feekind: await q(`
    SELECT COALESCE(fee_kind,'(null)') AS fee_kind, payment_type,
           SUM(amount) AS sum_amount, COUNT(*) AS n
    FROM public.package_payments WHERE customer_id='${cid}'
    GROUP BY fee_kind, payment_type ORDER BY fee_kind, payment_type;
  `),
  payments_by_method: await q(`
    SELECT method, payment_type, SUM(amount) AS sum_amount, COUNT(*) AS n
    FROM public.payments WHERE customer_id='${cid}'
    GROUP BY method, payment_type ORDER BY method, payment_type;
  `),
};

const stamp = process.argv[2] || 'PRE';
writeFileSync(`scripts/F4857_forensic_${stamp}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.error(`\n[OK] evidence → scripts/F4857_forensic_${stamp}.json  (customer=${cust.name} ${cust.chart_number} id=${cid})`);

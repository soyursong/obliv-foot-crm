/**
 * T-20260819-foot-CLOSING-CASH-REFUND-SUM-MISMATCH — Phase A READ-ONLY 진단
 * 증상: 2026-08-18 마감 [현금] 합계 CRM=635,400 vs 현장 수동합=735,400 (diff 100,000).
 * 가설: 리스트(enrichedRows)=pkgPaymentsForList(accounting_date 축) vs 합계(totals)=pkgPayments(created_at 축)
 *        두 축이 갈리는 패키지 현금결제(선수금/익일귀속)로 인한 구조적 divergence.
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL/정정 0.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);
const D = '2026-08-18';
const START = `${D}T00:00:00+09:00`, END = `${D}T23:59:59+09:00`;

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

// clinic_id 파악 — 화면 고객(강경민/송지현 등)이 속한 clinic
console.log('\n=== 0. 대상 clinic_id (foot 종로) ===');
console.log(j(await q(`SELECT id, name FROM public.clinics ORDER BY created_at;`)));

// ── 1. 단건 payments 현금 — created_at 축(합계 소스 = 리스트 소스 동일) ──
console.log('\n=== 1. payments(단건) 현금 · created_at 축 (양 경로 동일) ===');
console.log(j(await q(`SELECT p.id, p.customer_id, c.name, p.amount, p.payment_type, p.method,
    p.created_at, p.accounting_date, p.status, p.check_in_id
  FROM public.payments p LEFT JOIN public.customers c ON c.id=p.customer_id
  WHERE p.method='cash' AND p.created_at >= '${START}' AND p.created_at <= '${END}'
    AND coalesce(p.status,'') <> 'deleted'
  ORDER BY p.created_at;`)));

// ── 2. package_payments 현금 · created_at 축 (= totals/합계 소스, pkgPayments) ──
console.log('\n=== 2. package_payments 현금 · created_at 축 = 합계(totals) 소스 ===');
console.log(j(await q(`SELECT pp.id, pp.customer_id, c.name, pp.amount, pp.payment_type, pp.method,
    pp.created_at, pp.accounting_date, pp.parent_payment_id
  FROM public.package_payments pp LEFT JOIN public.customers c ON c.id=pp.customer_id
  WHERE pp.method='cash' AND pp.created_at >= '${START}' AND pp.created_at <= '${END}'
  ORDER BY pp.created_at;`)));

// ── 3. package_payments 현금 · accounting_date 축 (= enrichedRows/리스트 소스, pkgPaymentsForList) ──
console.log('\n=== 3. package_payments 현금 · accounting_date=대상일 = 리스트(enrichedRows) 소스 ===');
console.log(j(await q(`SELECT pp.id, pp.customer_id, c.name, pp.amount, pp.payment_type, pp.method,
    pp.created_at, pp.accounting_date, pp.parent_payment_id
  FROM public.package_payments pp LEFT JOIN public.customers c ON c.id=pp.customer_id
  WHERE pp.method='cash' AND pp.accounting_date = '${D}'
  ORDER BY pp.created_at;`)));

// ── 4. 핵심: 두 축의 차집합 (divergence 실증) ──
console.log('\n=== 4. ★divergence: accounting_date=대상일 이나 created_at≠대상일 (리스트에만, 합계 누락) ===');
console.log(j(await q(`SELECT pp.id, c.name, pp.amount, pp.payment_type, pp.created_at, pp.accounting_date
  FROM public.package_payments pp LEFT JOIN public.customers c ON c.id=pp.customer_id
  WHERE pp.method='cash' AND pp.accounting_date = '${D}'
    AND NOT (pp.created_at >= '${START}' AND pp.created_at <= '${END}')
  ORDER BY pp.created_at;`)));

console.log('\n=== 4b. 역방향: created_at=대상일 이나 accounting_date≠대상일 (합계에만, 리스트 누락) ===');
console.log(j(await q(`SELECT pp.id, c.name, pp.amount, pp.payment_type, pp.created_at, pp.accounting_date
  FROM public.package_payments pp LEFT JOIN public.customers c ON c.id=pp.customer_id
  WHERE pp.method='cash' AND pp.created_at >= '${START}' AND pp.created_at <= '${END}'
    AND coalesce(pp.accounting_date::text,'') <> '${D}'
  ORDER BY pp.created_at;`)));

// ── 5. manual(수기) 현금 — 양 경로 동일 ──
console.log('\n=== 5. closing_manual_payments 현금 (양 경로 동일 소스) ===');
console.log(j(await q(`SELECT id, customer_name, amount, method, close_date, voided_at
  FROM public.closing_manual_payments
  WHERE method='cash' AND close_date='${D}' AND voided_at IS NULL ORDER BY pay_time;`)));

// ── 6. 합산 대조: 합계(totals) 축 vs 리스트(enrichedRows) 축 ──
console.log('\n=== 6. ★현금 NET 합산 대조 (합계축 vs 리스트축) ===');
console.log(j(await q(`WITH
  pay_cash AS (SELECT coalesce(sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) v
    FROM public.payments WHERE method='cash' AND created_at >= '${START}' AND created_at <= '${END}' AND coalesce(status,'')<>'deleted'),
  pkg_cash_created AS (SELECT coalesce(sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) v
    FROM public.package_payments WHERE method='cash' AND created_at >= '${START}' AND created_at <= '${END}'),
  pkg_cash_acct AS (SELECT coalesce(sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) v
    FROM public.package_payments WHERE method='cash' AND accounting_date='${D}'),
  man_cash AS (SELECT coalesce(sum(amount),0) v FROM public.closing_manual_payments
    WHERE method='cash' AND close_date='${D}' AND voided_at IS NULL)
  SELECT (SELECT v FROM pay_cash) pay_cash,
    (SELECT v FROM pkg_cash_created) pkg_cash_created_axis,
    (SELECT v FROM pkg_cash_acct) pkg_cash_acct_axis,
    (SELECT v FROM man_cash) manual_cash,
    (SELECT v FROM pay_cash)+(SELECT v FROM pkg_cash_created)+(SELECT v FROM man_cash) total_cash_HAP_axis,
    (SELECT v FROM pay_cash)+(SELECT v FROM pkg_cash_acct)+(SELECT v FROM man_cash) list_cash_LIST_axis,
    ((SELECT v FROM pkg_cash_acct)-(SELECT v FROM pkg_cash_created)) diff_list_minus_hap;`)));

console.log('\n=== DONE (READ-ONLY) ===');

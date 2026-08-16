/**
 * T-20260815-foot-PKGPAY-PHANTOM-SELFOFFSET-CENSUS-LEG1 — READ-ONLY census
 * foot.package_payments 8/10 자기상쇄쌍(2,960,000 pay/refund, 33s) 생성경로 지문 + 전수 self-offset census.
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

console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

console.log('\n=== 0. package_payments 컬럼 실재 (계보/멱등/처리자 축) ===');
console.log(j(await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_payments' ORDER BY ordinal_position;`)));

console.log('\n=== 1. 8월 MTD package_payments 요약 (is_simulation IS NOT TRUE) ===');
console.log(j(await q(`SELECT
    count(*) FILTER (WHERE pp.payment_type='payment') pay_n,
    coalesce(sum(pp.amount) FILTER (WHERE pp.payment_type='payment'),0) pay_sum,
    count(*) FILTER (WHERE pp.payment_type='refund') ref_n,
    coalesce(sum(pp.amount) FILTER (WHERE pp.payment_type='refund'),0) ref_sum,
    coalesce(sum(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END),0) net
  FROM public.package_payments pp
  LEFT JOIN public.customers c ON c.id = pp.customer_id
  WHERE pp.created_at >= '2026-08-01' AND pp.created_at < '2026-09-01'
    AND pp.is_simulation IS NOT TRUE;`)));

console.log('\n=== 2. 8/10 대상쌍 지문 — 2,960,000 근처 전 8월 행 raw ===');
console.log(j(await q(`SELECT pp.id, pp.package_id, pp.customer_id, pp.amount, pp.method,
    pp.payment_type, pp.parent_payment_id, pp.created_by, pp.created_at,
    pp.fee_kind, pp.payment_attempt_id, pp.external_approval_no, pp.external_tid,
    pp.is_simulation, c.is_test, c.name cust_name
  FROM public.package_payments pp
  LEFT JOIN public.customers c ON c.id = pp.customer_id
  WHERE pp.created_at >= '2026-08-01' AND pp.created_at < '2026-09-01'
    AND pp.amount = 2960000
  ORDER BY pp.created_at;`)));

console.log('\n=== 3. 쌍 매칭 — refund.parent_payment_id 로 payment 지목 + Δt ===');
console.log(j(await q(`WITH aug AS (
    SELECT * FROM public.package_payments
     WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01' AND is_simulation IS NOT TRUE)
  SELECT r.id refund_id, r.amount refund_amt, r.created_at refund_at, r.created_by refund_by,
    r.parent_payment_id, p.id pay_id, p.amount pay_amt, p.created_at pay_at, p.created_by pay_by,
    p.payment_attempt_id pay_attempt,
    (r.amount = p.amount) exact_offset,
    EXTRACT(EPOCH FROM (r.created_at - p.created_at)) delta_sec
  FROM aug r
  LEFT JOIN public.package_payments p ON p.id = r.parent_payment_id
  WHERE r.payment_type='refund'
  ORDER BY r.created_at;`)));

console.log('\n=== 4. created_by 주체 해석 — user_profiles 조인 (실스태프 vs NULL/시스템) ===');
console.log(j(await q(`SELECT pp.id, pp.payment_type, pp.amount, pp.created_by, pp.created_at,
    up.name staff_name, up.role staff_role
  FROM public.package_payments pp
  LEFT JOIN public.user_profiles up ON up.id = pp.created_by
  WHERE pp.created_at >= '2026-08-01' AND pp.created_at < '2026-09-01'
    AND pp.amount = 2960000
  ORDER BY pp.created_at;`)));

console.log('\n=== 5. 대상쌍 패키지 상태 정합 (status/used 회차) ===');
console.log(j(await q(`SELECT pk.id pkg_id, pk.status, pk.total_amount, pk.paid_amount,
    pk.total_sessions, pk.created_at pkg_created,
    (SELECT count(*) FROM public.package_sessions ps WHERE ps.package_id=pk.id AND ps.status='used') used_n,
    (SELECT count(*) FROM public.package_sessions ps WHERE ps.package_id=pk.id) total_ps
  FROM public.packages pk
  WHERE pk.id IN (SELECT DISTINCT package_id FROM public.package_payments
    WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01' AND amount=2960000);`)));

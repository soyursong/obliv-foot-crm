/**
 * T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET — READ-ONLY census
 * DA gate order ① : revenue-basis 재버킷의 read-source = payment-linkage(원결제 charge.method).
 *   linkage(단건 linked_payment_id / 패키지 parent_payment_id) NULL 인 환불행 = Axis-A 판정불가
 *   → anti-fabrication honest fallback 대상. 그 건수를 노출한다.
 * DA gate order ② : daily_closings persist / outbox payload totals{} / A6 는 코드 인스펙션으로 확인(별도).
 * GATE: READ-ONLY — SELECT only. prod write/DDL/정정 0. (money-path·물리 GO-token 前, 표시 projection 만)
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

// ── 1. 단건 payments 환불행 linkage census (전체 + NULL-linkage) ──
console.log('\n=== 1. payments(단건) 환불행 linkage census ===');
console.log(j(await q(`SELECT
    count(*)                                             refund_rows,
    count(*) FILTER (WHERE linked_payment_id IS NULL)    null_linkage,
    count(*) FILTER (WHERE linked_payment_id IS NOT NULL) has_linkage
  FROM public.payments WHERE payment_type='refund';`)));

// ── 2. 패키지 package_payments 환불행 linkage census ──
console.log('\n=== 2. package_payments(패키지) 환불행 linkage census ===');
console.log(j(await q(`SELECT
    count(*)                                              refund_rows,
    count(*) FILTER (WHERE parent_payment_id IS NULL)     null_linkage,
    count(*) FILTER (WHERE parent_payment_id IS NOT NULL) has_linkage
  FROM public.package_payments WHERE payment_type='refund';`)));

// ── 3. 교차수단 환불행 census (환불행 stored method ≠ 원결제행 method) — linkage 조인으로 실제 재버킷 대상 ──
console.log('\n=== 3. payments 교차수단 환불(stored method ≠ 원결제 method via linkage) ===');
console.log(j(await q(`SELECT
    count(*) cross_method_rows,
    count(*) FILTER (WHERE o.id IS NULL) linkage_out_of_scope
  FROM public.payments r
  LEFT JOIN public.payments o ON o.id = r.linked_payment_id
  WHERE r.payment_type='refund' AND r.linked_payment_id IS NOT NULL
    AND (o.method IS NULL OR o.method <> r.method);`)));

console.log('\n=== 4. package_payments 교차수단 환불 census ===');
console.log(j(await q(`SELECT
    count(*) cross_method_rows,
    count(*) FILTER (WHERE o.id IS NULL) linkage_out_of_scope
  FROM public.package_payments r
  LEFT JOIN public.package_payments o ON o.id = r.parent_payment_id
  WHERE r.payment_type='refund' AND r.parent_payment_id IS NOT NULL
    AND (o.method IS NULL OR o.method <> r.method);`)));

// ── 5. 이금득 08-18 실증 케이스 (원결제=card / 환불 stored=cash) ──
console.log('\n=== 5. 08-18 교차수단 환불 실증 (payments, 원결제 method != 환불 stored method) ===');
console.log(j(await q(`SELECT r.id refund_id, r.method refund_method, r.amount, r.linked_payment_id,
    o.method orig_method, r.created_at
  FROM public.payments r
  LEFT JOIN public.payments o ON o.id = r.linked_payment_id
  WHERE r.payment_type='refund'
    AND r.created_at >= '2026-08-18' AND r.created_at < '2026-08-19'
    AND (o.method IS NULL OR o.method <> r.method)
  ORDER BY r.created_at;`)));

console.log('\n=== CENSUS DONE (READ-ONLY, prod write 0) ===');

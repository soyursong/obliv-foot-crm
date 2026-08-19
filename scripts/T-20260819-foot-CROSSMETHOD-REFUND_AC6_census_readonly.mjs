/**
 * T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX — AC-6 census (READ-ONLY)
 * 과거 교차수단 환불(환불행 method ≠ 원결제 method) 전수 census.
 *   ① package_payments (parent_payment_id 링크 → refund_package_payment / refund_package_atomic)
 *   ② payments        (parent_payment_id 링크 → refund_single_payment)
 * 산출: 날짜·건수·수단쌍·결제수단별 왜곡액 + 각 건 net 정상 여부.
 * GATE: READ-ONLY — SELECT only. prod write/DDL 0.
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

// ── ① package_payments 교차수단 환불 census ──────────────────────────────────
console.log('\n=== ① package_payments — 환불행 method ≠ 원결제(parent) method ===');
console.log(j(await q(`
  SELECT
    r.id            AS refund_id,
    r.parent_payment_id AS orig_id,
    to_char(r.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') AS refund_kst,
    r.amount        AS refund_amount,
    p.method        AS orig_method,
    r.method        AS refund_method,
    c.name          AS customer_name,
    r.is_simulation
  FROM public.package_payments r
  JOIN public.package_payments p ON p.id = r.parent_payment_id
  LEFT JOIN public.customers c ON c.id = r.customer_id
  WHERE r.payment_type = 'refund'
    AND p.method IS DISTINCT FROM r.method
  ORDER BY r.created_at;`)));

// ── ② payments 교차수단 환불 census (refund_single_payment) ──────────────────
console.log('\n=== ② payments — 환불행 method ≠ 원결제(parent) method ===');
console.log(j(await q(`
  SELECT
    r.id            AS refund_id,
    r.parent_payment_id AS orig_id,
    to_char(r.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') AS refund_kst,
    r.amount        AS refund_amount,
    p.method        AS orig_method,
    r.method        AS refund_method,
    c.name          AS customer_name,
    r.is_simulation
  FROM public.payments r
  JOIN public.payments p ON p.id = r.parent_payment_id
  LEFT JOIN public.customers c ON c.id = r.customer_id
  WHERE r.amount < 0 OR r.payment_type = 'refund' OR r.parent_payment_id IS NOT NULL
  ORDER BY r.created_at;`).catch(() => ({note:'payments schema differs — inspect below'}))));

// payments 스키마 실재 확인 (parent_payment_id / payment_type 컬럼 유무)
console.log('\n=== ②b payments 컬럼 실재 ===');
console.log(j(await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments' ORDER BY ordinal_position;`)));

// ── ③ 수단쌍 집계 + 결제수단별 왜곡액 ───────────────────────────────────────
console.log('\n=== ③ package_payments 수단쌍별 집계 (건수·환불총액) ===');
console.log(j(await q(`
  SELECT p.method AS orig_method, r.method AS refund_method,
         count(*) AS n, sum(r.amount) AS refund_sum
  FROM public.package_payments r
  JOIN public.package_payments p ON p.id = r.parent_payment_id
  WHERE r.payment_type='refund' AND p.method IS DISTINCT FROM r.method
  GROUP BY 1,2 ORDER BY refund_sum DESC;`)));

console.log('\n=== DONE (READ-ONLY, prod write 0) ===');

const REF = 'rxlomoozakkjesdqjtvd';
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const o=await r.json().catch(()=>null);if(r.status!==200&&r.status!==201){console.error('HTTP',r.status,JSON.stringify(o));process.exit(1);}return o;}
const j=x=>JSON.stringify(x,null,2);

console.log('=== A. 전기간 package_payments self-offset 쌍 CLASS 분류 (CAT-test vs staff-refund) ===');
console.log(j(await q(`
WITH refunds AS (
  SELECT r.id refund_id, r.amount, r.created_at r_at, r.created_by r_by,
    r.parent_payment_id, r.payment_attempt_id r_attempt, r.external_approval_no r_authno,
    r.customer_id, c.is_test, c.is_simulation cust_sim, c.name cust_name
  FROM package_payments r LEFT JOIN customers c ON c.id=r.customer_id
  WHERE r.payment_type='refund' AND r.is_simulation IS NOT TRUE
)
SELECT
  CASE
    WHEN parent_payment_id IS NULL AND r_attempt IS NOT NULL THEN 'A_CAT_terminal_cancel(external_authno link)'
    WHEN parent_payment_id IS NOT NULL AND r_by IS NOT NULL     THEN 'B_staff_refund_RPC(parent link+staff)'
    WHEN parent_payment_id IS NOT NULL AND r_by IS NULL         THEN 'C_legacy_refund(parent link,no actor)'
    ELSE 'D_other(unlinked,no attempt)'
  END AS class,
  count(*) n,
  count(*) FILTER (WHERE is_test) n_is_test,
  min(r_at) first_at, max(r_at) last_at
FROM refunds GROUP BY 1 ORDER BY 1;`)));

console.log('\n=== B. Class A (CAT terminal cancel, parent NULL + attempt) 전건 raw ===');
console.log(j(await q(`
SELECT r.id refund_id, r.amount, r.created_at, r.external_approval_no, r.external_tid,
  r.payment_attempt_id, r.customer_id, c.is_test, c.name,
  (SELECT p.id FROM package_payments p WHERE p.payment_type='payment'
     AND p.external_approval_no=r.external_approval_no AND p.package_id=r.package_id
     AND p.amount=r.amount ORDER BY p.created_at LIMIT 1) matched_pay_id,
  (SELECT EXTRACT(EPOCH FROM (r.created_at - p.created_at)) FROM package_payments p
     WHERE p.payment_type='payment' AND p.external_approval_no=r.external_approval_no
     AND p.package_id=r.package_id AND p.amount=r.amount ORDER BY p.created_at LIMIT 1) delta_sec
FROM package_payments r LEFT JOIN customers c ON c.id=r.customer_id
WHERE r.payment_type='refund' AND r.parent_payment_id IS NULL AND r.payment_attempt_id IS NOT NULL
  AND r.is_simulation IS NOT TRUE
ORDER BY r.created_at;`)));

console.log('\n=== C. CEO 보고 대상쌍(8/10 23:20)이 is_test 인지 명시 확인 ===');
console.log(j(await q(`
SELECT pp.id, pp.payment_type, pp.amount, pp.created_at, pp.is_simulation,
  c.is_test, c.is_simulation cust_sim, c.name
FROM package_payments pp LEFT JOIN customers c ON c.id=pp.customer_id
WHERE pp.id IN ('c9cc7a86-6dad-4d48-bae0-9771c3f5ab5a','8e05684d-8493-42dd-939c-667cc25bdbaa');`)));

console.log('\n=== D. payments(비패키지) 테이블도 동일 CAT-cancel self-offset 클래스 존재하는지 (8월) ===');
console.log(j(await q(`
SELECT
  count(*) FILTER (WHERE payment_type='refund') ref_n,
  count(*) FILTER (WHERE payment_type='refund' AND payment_attempt_id IS NOT NULL) ref_cat_n,
  count(*) FILTER (WHERE payment_type='payment') pay_n
FROM payments
WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01' AND is_simulation IS NOT TRUE;`)));

console.log('\n=== E. 8월 net=0 exact self-offset 패키지(전액환불) — 오염 아닌 정당취소 여부 판별용 provenance ===');
console.log(j(await q(`
WITH pk AS (
  SELECT package_id,
    SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) net_paid,
    count(*) FILTER (WHERE payment_type='payment') pay_n,
    count(*) FILTER (WHERE payment_type='refund') ref_n,
    bool_or(payment_attempt_id IS NOT NULL) any_cat,
    bool_or(created_by IS NOT NULL) any_actor
  FROM package_payments
  WHERE created_at>='2026-08-01' AND created_at<'2026-09-01' AND is_simulation IS NOT TRUE
  GROUP BY package_id)
SELECT pk.*, p.status pkg_status, c.is_test, c.name
FROM pk JOIN packages p ON p.id=pk.package_id
  LEFT JOIN customers c ON c.id=p.customer_id
WHERE pk.net_paid=0 AND pk.ref_n>0
ORDER BY pk.any_cat DESC, pk.package_id;`)));

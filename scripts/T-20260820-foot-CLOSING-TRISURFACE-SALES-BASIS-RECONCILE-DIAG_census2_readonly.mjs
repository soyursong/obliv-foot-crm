/**
 * T-20260820 TRISURFACE RECONCILE — census part 2 (READ-ONLY)
 * DIV-3 sim 정량화 + DIV-6 rebucket per-method(revenue vs raw) + DIV-4 per-staff B(live) vs D(snapshot).
 * auth: Management API postgres 슈퍼유저(무RLS). SELECT only.
 */
const REF = 'rxlomoozakkjesdqjtvd';
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: no token'); process.exit(1); }
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const o=await r.json().catch(()=>null);if(r.status!==200&&r.status!==201){console.error(`HTTP ${r.status}`,JSON.stringify(o));process.exit(1);}return o;}
const j=x=>JSON.stringify(x,null,2);
const CID = "'74967aea-a60b-4da3-a0e7-9c997a930bc8'"; // 서울 오리진(현장 주 클리닉). 필요시 송도 별도.

for (const D of ['2026-08-18','2026-08-20']) {
  console.log(`\n######## ${D} (clinic=서울오리진) ########`);
  const s=`${D}T00:00:00+09:00`, e=`${D}T23:59:59.999+09:00`;

  // ── DIV-3: sim/test 고객 결제 (A/B/C 계상 vs D 제외) — 단건+패키지 ──
  console.log('\n--- DIV-3 sim/test 고객 결제 (D는 제외, A/B/C는 포함) ---');
  console.log('단건 payments (accounting_date):');
  console.log(j(await q(`
    SELECT COALESCE(c.is_simulation,false) sim, COALESCE(c.is_test,false) test,
           count(*) rows, COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM payments p LEFT JOIN customers c ON c.id=p.customer_id
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted')
    GROUP BY 1,2 ORDER BY 1,2;`)));
  console.log('패키지 package_payments (accounting_date):');
  console.log(j(await q(`
    SELECT COALESCE(c.is_simulation,false) sim, COALESCE(c.is_test,false) test,
           count(*) rows, COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM package_payments p LEFT JOIN customers c ON c.id=p.customer_id
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}'
    GROUP BY 1,2 ORDER BY 1,2;`)));

  // ── DIV-6: rebucket 재현 — 환불행을 원결제 method 버킷으로 재귀속(revenue) vs 저장 method(raw) ──
  //   단건: linked_payment_id→원결제 payments.method / 패키지: parent_payment_id→원결제 package_payments.method
  console.log('\n--- DIV-6 rebucket per-method: raw(저장 method) vs revenue(원결제 method) — 합계카드 vs 결제내역/담당자별 ---');
  console.log('단건 raw net (저장 method별) [C 축=created_at, A/B 축=created_at 단건 동일]:');
  console.log(j(await q(`
    SELECT method, COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net_raw
    FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted'
    GROUP BY method ORDER BY method;`)));
  console.log('단건 revenue net (환불행은 원결제 method 버킷):');
  console.log(j(await q(`
    WITH base AS (
      SELECT p.id, p.amount, p.payment_type,
             CASE WHEN p.payment_type='refund'
                  THEN COALESCE(o.method, p.method)  -- 원결제 method(linkage), 없으면 저장 method(honest fallback)
                  ELSE p.method END AS rev_method,
             (p.payment_type='refund' AND p.linked_payment_id IS NOT NULL AND o.method IS NOT NULL) AS resolved,
             (p.payment_type='refund' AND (p.linked_payment_id IS NULL OR o.method IS NULL)) AS unresolved
      FROM payments p
      LEFT JOIN payments o ON o.id = p.linked_payment_id
      WHERE p.clinic_id=${CID} AND p.created_at>='${s}' AND p.created_at<='${e}' AND p.status<>'deleted'
    )
    SELECT rev_method AS method,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net_revenue
    FROM base GROUP BY rev_method ORDER BY rev_method;`)));
  console.log('패키지 raw net (저장 method) [C 축=created_at]:');
  console.log(j(await q(`
    SELECT method, COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net_raw
    FROM package_payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}'
    GROUP BY method ORDER BY method;`)));
  console.log('패키지 revenue net (환불행은 원결제 package_payments.method):');
  console.log(j(await q(`
    WITH base AS (
      SELECT p.id, p.amount, p.payment_type,
             CASE WHEN p.payment_type='refund' THEN COALESCE(o.method,p.method) ELSE p.method END AS rev_method
      FROM package_payments p
      LEFT JOIN package_payments o ON o.id = p.parent_payment_id
      WHERE p.clinic_id=${CID} AND p.created_at>='${s}' AND p.created_at<='${e}'
    )
    SELECT rev_method AS method,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net_revenue
    FROM base GROUP BY rev_method ORDER BY rev_method;`)));

  // ── DIV-4: per-staff B(live assigned) vs D(snapshot attributed) — 실장별 총합 대조 ──
  //   단건(accounting_date) net 을 두 귀속축으로 각각 집계 → 총합 동일해야(재배정은 이전만), per-staff만 이동.
  console.log('\n--- DIV-4 per-staff 단건 net: B(live assigned_staff_id) vs D(attributed_staff_id snapshot) ---');
  console.log('B축(live assigned_staff_id) — 담당자별 소계 방식:');
  console.log(j(await q(`
    SELECT COALESCE(c.assigned_staff_id::text,'미지정') staff,
           COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM payments p LEFT JOIN customers c ON c.id=p.customer_id
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted')
    GROUP BY 1 ORDER BY net DESC;`)));
  console.log('D축(attributed_staff_id snapshot→live fallback) — 실장별 일별 방식:');
  console.log(j(await q(`
    SELECT COALESCE(COALESCE(p.attributed_staff_id, c.assigned_staff_id)::text,'미지정') staff,
           COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM payments p LEFT JOIN customers c ON c.id=p.customer_id
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted')
    GROUP BY 1 ORDER BY net DESC;`)));
}
console.log('\n=== 완료 (READ-ONLY, prod write 0) ===');

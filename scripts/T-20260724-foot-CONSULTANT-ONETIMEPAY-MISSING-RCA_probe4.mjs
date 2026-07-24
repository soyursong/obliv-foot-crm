import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CL="74967aea-a60b-4da3-a0e7-9c997a930bc8";
const out={};

// F) 누락 단건결제(payments) 정체: method/memo/금액 (7월, non-pkg, 미귀속)
out.F_missing_single_profile = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT pay.method, count(*) n, sum(pay.amount) amt,
         count(*) FILTER (WHERE pay.check_in_id IS NULL) no_checkin
  FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
  WHERE pay.clinic_id='${CL}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled') AND pay.deleted_at IS NULL
    AND pay.package_id IS NULL AND ta.consultant_id IS NULL
  GROUP BY 1 ORDER BY amt DESC;`);

// G) 핵심 분기검증: 누락 단건결제 고객이 '전기간 상담이력(ticketed_all)'을 가지고 있는가?
//    가지고 있으면 → customer 기반이라면 귀속 가능했음 = 귀속방식 불일치(분기 A 후보)
//    전무하면 → 애초에 상담사 귀속 불가 = by-design(분기 B)
out.G_missing_has_consult = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  missing AS (
    SELECT pay.id, pay.customer_id, pay.amount
    FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
    WHERE pay.clinic_id='${CL}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
      AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled') AND pay.deleted_at IS NULL
      AND pay.package_id IS NULL AND ta.consultant_id IS NULL
  )
  SELECT
    (EXISTS (SELECT 1 FROM ticketed_all t WHERE t.customer_id=m.customer_id)) AS cust_has_consult,
    (m.customer_id IS NULL) AS no_customer,
    count(*) n, sum(m.amount) amt
  FROM missing m GROUP BY 1,2 ORDER BY 1,2;`);

// H) 참고: payments.check_in_id 채워짐 비율 전체 (write-path 갭 진단)
out.H_checkin_fill = await q(`
  SELECT (check_in_id IS NULL) AS no_checkin, (package_id IS NULL) AS non_pkg,
         count(*) n, sum(amount) amt
  FROM payments WHERE clinic_id='${CL}' AND accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    AND COALESCE(status,'active') NOT IN ('deleted','cancelled') AND deleted_at IS NULL
  GROUP BY 1,2 ORDER BY 1,2;`);

// I) 누락 단건결제 샘플 10건 (memo로 정체 파악)
out.I_sample = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT pay.amount, pay.method, pay.payment_type, left(coalesce(pay.memo,''),40) memo,
         (pay.check_in_id IS NOT NULL) has_ci, (pay.customer_id IS NOT NULL) has_cust
  FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
  WHERE pay.clinic_id='${CL}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled') AND pay.deleted_at IS NULL
    AND pay.package_id IS NULL AND ta.consultant_id IS NULL
  ORDER BY pay.amount DESC LIMIT 12;`);

console.log(JSON.stringify(out,null,2));

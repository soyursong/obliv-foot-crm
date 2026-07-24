import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CL="74967aea-a60b-4da3-a0e7-9c997a930bc8";
const out={};

// 최근 package_payments accounting_date 분포
out.recent_pp_dates = await q(`
  SELECT accounting_date, count(*) n, sum(amount) amt
  FROM package_payments WHERE clinic_id='${CL}' AND accounting_date>='2026-07-01'
  GROUP BY accounting_date ORDER BY accounting_date DESC LIMIT 30;`);

// 7월 전체 range 로 핵심 분석: 1회성(total_sessions<=1) vs 다회 × pkg_attr 매핑 여부
out.july_pkg_attr = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id=p.customer_id
    WHERE p.clinic_id='${CL}'
    ORDER BY p.id, (ta.checked_in_at<=p.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (p.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  ),
  pp AS (
    SELECT pp.package_id, pp.amount, pp.payment_type, p.total_sessions, p.package_type
    FROM package_payments pp JOIN packages p ON p.id=pp.package_id
    WHERE pp.clinic_id='${CL}' AND pp.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
  )
  SELECT
    (pp.total_sessions<=1) AS is_onetime,
    (pa.consultant_id IS NOT NULL) AS pkg_attr_mapped,
    count(*) n_rows, count(DISTINCT pp.package_id) n_pkgs, sum(pp.amount) amt
  FROM pp LEFT JOIN pkg_attr pa ON pa.package_id=pp.package_id
  GROUP BY 1,2 ORDER BY 1,2;`);

// 단건결제 payments (7월) single_rev 귀속 여부
out.july_single = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT
    (pay.package_id IS NULL) AS is_nonpkg,
    (pay.check_in_id IS NOT NULL) AS has_checkin,
    (ta.consultant_id IS NOT NULL) AS mapped,
    count(*) n, sum(pay.amount) amt
  FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
  WHERE pay.clinic_id='${CL}' AND pay.accounting_date BETWEEN '2026-07-01' AND '2026-07-31'
    AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled') AND pay.deleted_at IS NULL
  GROUP BY 1,2,3 ORDER BY 1,2,3;`);

console.log(JSON.stringify(out,null,2));

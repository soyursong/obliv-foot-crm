/**
 * T-20260724-foot-CONSULTANT-TKTREV-ONETIMEPAY-MISSING-RCA — READ-ONLY core RCA.
 * SELECT only.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const CL = "74967aea-a60b-4da3-a0e7-9c997a930bc8"; // jongno-foot
const TODAY = "2026-07-24";
const out = {};

// A) 1회성 정의 후보 분포: total_sessions / package_type
out.A_pkgtype_dist = await q(`
  SELECT package_type, total_sessions, count(*) AS n
  FROM packages WHERE clinic_id='${CL}'
  GROUP BY package_type, total_sessions ORDER BY n DESC LIMIT 30;`);

// B) 오늘(accounting_date) package_payments 전체 (payment_type 포함)
out.B_pkg_pay_today = await q(`
  SELECT payment_type, count(*) AS n, sum(amount) AS amt
  FROM package_payments WHERE clinic_id='${CL}' AND accounting_date='${TODAY}'
  GROUP BY payment_type;`);

// C) 오늘 package_payments → packages join, 1회성(total_sessions<=1) 여부 + pkg_attr consultant_id 재현
//    pkg_attr = 동일고객 ticketed_all(consultation, consultant_id NOT NULL) 중 created_at 최근접
out.C_onetime_pkg_attr = await q(`
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
  today_pp AS (
    SELECT pp.package_id, pp.amount, pp.payment_type, p.total_sessions, p.package_type,
           p.customer_id, p.created_at, p.consultant_id AS captured_cid
    FROM package_payments pp JOIN packages p ON p.id=pp.package_id
    WHERE pp.clinic_id='${CL}' AND pp.accounting_date='${TODAY}'
  )
  SELECT
    (t.total_sessions<=1) AS is_onetime,
    (pa.consultant_id IS NOT NULL) AS pkg_attr_mapped,
    count(*) AS n_payrows,
    count(DISTINCT t.package_id) AS n_pkgs,
    sum(t.amount) AS amt
  FROM today_pp t LEFT JOIN pkg_attr pa ON pa.package_id=t.package_id
  GROUP BY 1,2 ORDER BY 1,2;`);

// D) 1회성 패키지 오늘 결제 건별 상세 (누락 여부 근거)
out.D_onetime_detail = await q(`
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
  )
  SELECT p.id AS package_id, p.package_name, p.total_sessions, p.package_type,
         pp.amount, pp.payment_type,
         pa.consultant_id AS pkg_attr_cid, p.consultant_id AS captured_cid,
         (SELECT count(*) FROM ticketed_all ta WHERE ta.customer_id=p.customer_id) AS cust_ticketed_cnt
  FROM package_payments pp JOIN packages p ON p.id=pp.package_id
  LEFT JOIN pkg_attr pa ON pa.package_id=p.id
  WHERE pp.clinic_id='${CL}' AND pp.accounting_date='${TODAY}' AND p.total_sessions<=1
  ORDER BY pp.amount DESC;`);

// E) 오늘 단건결제(payments, package_id IS NULL) → single_rev 귀속 여부 (check_in_id → ticketed_all)
out.E_single_pay_today = await q(`
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
    WHERE ci.clinic_id='${CL}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  )
  SELECT
    (pay.package_id IS NULL) AS is_single_nonpkg,
    (pay.check_in_id IS NOT NULL) AS has_checkin,
    (ta.consultant_id IS NOT NULL) AS single_rev_mapped,
    count(*) AS n, sum(pay.amount) AS amt
  FROM payments pay LEFT JOIN ticketed_all ta ON ta.check_in_id=pay.check_in_id
  WHERE pay.clinic_id='${CL}' AND pay.accounting_date='${TODAY}'
    AND COALESCE(pay.status,'active') NOT IN ('deleted','cancelled')
    AND pay.deleted_at IS NULL
  GROUP BY 1,2,3 ORDER BY 1,2,3;`);

console.log(JSON.stringify(out, null, 2));

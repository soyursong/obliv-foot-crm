/**
 * T-20260810-foot-ARCHE-PORPHAN-CORRECTION — dev-foot BLOCKING census (READ-ONLY, SELECT-only).
 * Q-A Leg-B(선수금 원장) 존재여부 / Q-B foot-schema exact-anchor / Q-C 62 3-partition.
 * prod write/DDL 0. 정정/apply 착수 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const out={};

// ── HEALTHY 49 anchor reverse-engineering: how do healthy cis rows link to package_sessions? ──
// For healthy rows (is_pkg=true, sid NOT NULL): does the linked package_session share cis.check_in_id?
out.healthy_anchor_shape = await q(`
  SELECT
    COUNT(*) AS healthy_total,
    COUNT(*) FILTER (WHERE ps.check_in_id = cis.check_in_id) AS ps_checkin_matches_cis,
    COUNT(*) FILTER (WHERE ps.check_in_id IS NULL)           AS ps_checkin_null,
    COUNT(*) FILTER (WHERE ps.check_in_id IS DISTINCT FROM cis.check_in_id AND ps.check_in_id IS NOT NULL) AS ps_checkin_diff
  FROM check_in_services cis
  JOIN package_sessions ps ON ps.id = cis.package_session_id
  WHERE cis.is_package_session = true AND cis.package_session_id IS NOT NULL;
`);

// healthy: does linked package_session's session_type / service_type relate to cis.service_name?
out.healthy_type_shape = await q(`
  SELECT ps.session_type, ps.service_type, cis.service_name, COUNT(*) AS n
  FROM check_in_services cis
  JOIN package_sessions ps ON ps.id = cis.package_session_id
  WHERE cis.is_package_session = true AND cis.package_session_id IS NOT NULL
  GROUP BY 1,2,3 ORDER BY n DESC LIMIT 40;
`);

// ── Q-A: payment-timing model. Are package_payments clustered at purchase (contract) or spread per-visit? ──
// Compare package_payments count per package vs total_sessions; and payment date vs contract_date vs session dates.
out.pkgpay_per_pkg = await q(`
  WITH pp AS (
    SELECT package_id, COUNT(*) AS n_pay, MIN(created_at::date) AS first_pay, MAX(created_at::date) AS last_pay
    FROM package_payments WHERE COALESCE(is_simulation,false)=false GROUP BY package_id
  )
  SELECT
    COUNT(*) AS pkgs_with_pay,
    COUNT(*) FILTER (WHERE n_pay=1) AS single_payment_pkgs,
    COUNT(*) FILTER (WHERE n_pay>1) AS multi_payment_pkgs,
    COUNT(*) FILTER (WHERE first_pay=last_pay) AS pay_same_day,
    COUNT(*) FILTER (WHERE first_pay<>last_pay) AS pay_spread_days
  FROM pp;
`);

// Q-A: paid_amount vs total_amount on packages (완납 vs 부분수납/미수)
out.pkg_paidfull = await q(`
  SELECT
    COUNT(*) AS total_pkgs,
    COUNT(*) FILTER (WHERE COALESCE(paid_amount,0) >= total_amount) AS paid_in_full,
    COUNT(*) FILTER (WHERE COALESCE(paid_amount,0) < total_amount)  AS underpaid,
    COUNT(*) FILTER (WHERE COALESCE(paid_amount,0) = 0)             AS zero_paid
  FROM packages WHERE COALESCE(status,'active') <> 'cancelled';
`);

// Q-A: does package_payments spread align with SESSION dates (per-visit) or contract date (at purchase)?
// For packages that have >1 payment, are payment dates matching session dates?
out.pay_vs_session_timing = await q(`
  WITH pp AS (SELECT package_id, created_at::date AS pd FROM package_payments WHERE COALESCE(is_simulation,false)=false),
       ps AS (SELECT package_id, session_date AS sd FROM package_sessions WHERE deleted_at IS NULL)
  SELECT
    (SELECT COUNT(DISTINCT package_id) FROM pp) AS pkgs_with_pay,
    (SELECT COUNT(*) FROM pp p JOIN ps s ON s.package_id=p.package_id AND s.sd=p.pd) AS pay_on_session_date,
    (SELECT COUNT(*) FROM pp) AS total_payments;
`);

console.log(JSON.stringify(out,null,2));

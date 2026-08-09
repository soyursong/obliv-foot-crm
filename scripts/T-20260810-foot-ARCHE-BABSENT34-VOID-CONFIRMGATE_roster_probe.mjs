// T-20260810-foot-ARCHE-BABSENT34-VOID-CONFIRMGATE — READ-ONLY roster probe
// ★ HARD CONSTRAINT: pure SELECT only. NO INSERT/UPDATE/DELETE/DDL/void. 34 rows untouched.
// Purpose: per-row roster of the B-absent 34 (is_package_session=true ∩ package_session_id IS NULL
//          ∩ zero matching package_session), for planner confirm-gate input.
// Predicate is inherited verbatim from parent T-20260810-foot-ARCHE-PORPHAN-CORRECTION_absent_probe.mjs.
import { readFileSync } from 'node:fs';
const env = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ── absent set = B-absent (34) : orphan cis with NO matching package_session on its check_in ──
const absentCTE = `
  WITH map AS (SELECT * FROM (VALUES
      ('비가열성 진균증 레이저 치료','unheated_laser'),('가열성 진균증 레이저 치료','heated_laser'),
      ('포돌로게(내성발톱 치료의료기기)','podologue'),('비가열레이저 - AF','unheated_laser')) AS m(service_name, session_type)),
  orphans AS (
    SELECT cis.id cis_pk, cis.check_in_id, cis.service_name, cis.created_at cis_created_at,
           cis.price, cis.voided_at, ci.customer_id, ci.created_date, ci.created_by,
           ci.customer_name, ci.visit_type,
           (SELECT session_type FROM map WHERE map.service_name=cis.service_name) AS mapped_st
    FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
    WHERE cis.is_package_session=true AND cis.package_session_id IS NULL),
  absent AS (
    SELECT o.* FROM orphans o WHERE NOT EXISTS(
      SELECT 1 FROM package_sessions ps JOIN packages p ON p.id=ps.package_id
      WHERE ps.check_in_id=o.check_in_id AND p.customer_id=o.customer_id AND ps.deleted_at IS NULL))`;

const out = {};

// 0) sanity: count must equal 34 (freeze integrity)
out.count = await q(`${absentCTE} SELECT COUNT(*) AS n_absent, COUNT(DISTINCT customer_id) AS n_customers FROM absent;`);

// 1) per-row roster (34 rows). created_by(text) resolved to display name via staff(user_id/id) then user_profiles(id).
out.roster = await q(`${absentCTE}
  SELECT
    a.cis_pk,
    a.check_in_id,
    a.customer_id,
    COALESCE(c.name, a.customer_name) AS cust_name,
    a.customer_name AS checkin_customer_name,
    c.is_simulation AS cust_is_simulation,
    a.created_by AS created_by_raw,
    COALESCE(s1.name, s2.name, up.name) AS created_by_display,
    COALESCE(s1.role, s2.role, up.role) AS created_by_role,
    a.created_date AS visit_date,
    a.cis_created_at,
    a.service_name,
    a.mapped_st AS session_type,
    a.visit_type,
    a.price,
    a.voided_at
  FROM absent a
  LEFT JOIN customers c ON c.id = a.customer_id
  LEFT JOIN staff s1 ON s1.user_id::text = a.created_by
  LEFT JOIN staff s2 ON s2.id::text = a.created_by
  LEFT JOIN user_profiles up ON up.id::text = a.created_by
  ORDER BY c.is_simulation DESC NULLS LAST, a.customer_id, a.created_date, a.cis_pk;`);

// 2) customer-level aggregate for suggested-classification support
out.by_customer = await q(`${absentCTE}
  SELECT a.customer_id, COUNT(*) AS n_rows,
    COALESCE(c.name, MAX(a.customer_name)) AS cust_name,
    c.is_simulation,
    (SELECT COUNT(*) FROM check_ins ci2 WHERE ci2.customer_id=a.customer_id) AS total_checkins_for_cust,
    (SELECT COUNT(*) FROM packages p2 WHERE p2.customer_id=a.customer_id) AS total_packages_for_cust,
    (SELECT MIN(ci3.created_date) FROM check_ins ci3 WHERE ci3.customer_id=a.customer_id) AS first_visit,
    (SELECT MAX(ci4.created_date) FROM check_ins ci4 WHERE ci4.customer_id=a.customer_id) AS last_visit
  FROM absent a LEFT JOIN customers c ON c.id=a.customer_id
  GROUP BY a.customer_id, c.name, c.is_simulation ORDER BY n_rows DESC, c.is_simulation DESC NULLS LAST;`);

// 3) freeze PK list (34 cis_pk) — void-time re-verification anchor
out.freeze_pks = await q(`${absentCTE} SELECT array_agg(cis_pk ORDER BY cis_pk) AS pks FROM absent;`);

console.log(JSON.stringify(out, null, 2));

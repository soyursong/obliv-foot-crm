import { readFileSync } from 'node:fs';
const env=readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};
// absent set = 34 orphans with NO package_session on their check_in
const absentCTE = `
  WITH map AS (SELECT * FROM (VALUES
      ('비가열성 진균증 레이저 치료','unheated_laser'),('가열성 진균증 레이저 치료','heated_laser'),
      ('포돌로게(내성발톱 치료의료기기)','podologue'),('비가열레이저 - AF','unheated_laser')) AS m(service_name, session_type)),
  orphans AS (
    SELECT cis.id cis_pk, cis.check_in_id, cis.service_name, ci.customer_id, ci.created_date,
           (SELECT session_type FROM map WHERE map.service_name=cis.service_name) AS mapped_st
    FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
    WHERE cis.is_package_session=true AND cis.package_session_id IS NULL),
  absent AS (
    SELECT o.* FROM orphans o WHERE NOT EXISTS(
      SELECT 1 FROM package_sessions ps JOIN packages p ON p.id=ps.package_id
      WHERE ps.check_in_id=o.check_in_id AND p.customer_id=o.customer_id AND ps.deleted_at IS NULL))`;

// A) do absent customers have ANY package at all?
out.absent_have_package = await q(`${absentCTE}
  SELECT COUNT(*) AS absent_total,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM packages p WHERE p.customer_id=a.customer_id)) AS cust_has_any_pkg,
    COUNT(DISTINCT a.customer_id) AS distinct_customers
  FROM absent a;`);

// B) for absent, are there package_sessions for same customer+type with NULL check_in_id OR different check_in but matching date?
out.absent_secondary_anchor = await q(`${absentCTE}
  SELECT
    COUNT(*) AS absent_total,
    COUNT(*) FILTER (WHERE EXISTS(
      SELECT 1 FROM package_sessions ps JOIN packages p ON p.id=ps.package_id
      WHERE p.customer_id=a.customer_id AND ps.session_type=a.mapped_st AND ps.deleted_at IS NULL
        AND ps.check_in_id IS NULL)) AS has_type_ps_nullcheckin,
    COUNT(*) FILTER (WHERE EXISTS(
      SELECT 1 FROM package_sessions ps JOIN packages p ON p.id=ps.package_id
      WHERE p.customer_id=a.customer_id AND ps.session_type=a.mapped_st AND ps.deleted_at IS NULL
        AND ps.session_date=a.created_date)) AS has_type_ps_samedate,
    COUNT(*) FILTER (WHERE EXISTS(
      SELECT 1 FROM package_sessions ps JOIN packages p ON p.id=ps.package_id
      WHERE p.customer_id=a.customer_id AND ps.session_type=a.mapped_st AND ps.deleted_at IS NULL)) AS has_any_type_ps
  FROM absent a;`);

// C) absent by customer (is it concentrated? test customer?)
out.absent_by_customer = await q(`${absentCTE}
  SELECT a.customer_id, COUNT(*) n,
    (SELECT c.name FROM customers c WHERE c.id=a.customer_id) AS cust_name,
    (SELECT c.is_simulation FROM customers c WHERE c.id=a.customer_id) AS is_sim
  FROM absent a GROUP BY a.customer_id ORDER BY n DESC;`);

// D) Also: are the 28 resolvable / 34 absent concentrated by customer? and is 83ab4fe1 a test customer?
out.testcust_check = await q(`
  SELECT id, name, is_simulation,
    (SELECT COUNT(*) FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
     WHERE ci.customer_id=customers.id AND cis.is_package_session=true AND cis.package_session_id IS NULL) AS orphan_cnt
  FROM customers WHERE id IN ('83ab4fe1-0bbc-4dfc-ab3b-f01378144707','1c61bad2-ad49-4e7d-92ae-2d132aae95cb');`);

console.log(JSON.stringify(out,null,2));

import { readFileSync } from 'node:fs';
const env=readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};

// service_name distinct in the 62 + full session_type universe
out.porphan_svcnames = await q(`
  SELECT service_name, COUNT(*) n FROM check_in_services
  WHERE is_package_session=true AND package_session_id IS NULL GROUP BY 1 ORDER BY n DESC;`);
out.session_types = await q(`SELECT DISTINCT session_type FROM package_sessions ORDER BY 1;`);

// STEP1: do the 62 P-orphan check_ins have ANY package_session with matching check_in_id?
out.step1_checkin_has_ps = await q(`
  WITH orphans AS (
    SELECT cis.id cis_pk, cis.check_in_id, cis.service_name, ci.customer_id
    FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
    WHERE cis.is_package_session=true AND cis.package_session_id IS NULL)
  SELECT
    (SELECT COUNT(*) FROM orphans) AS total_orphans,
    COUNT(*) FILTER (WHERE ps_cnt>0) AS orphans_with_ps_on_checkin,
    COUNT(*) FILTER (WHERE ps_cnt=0) AS orphans_no_ps_on_checkin
  FROM (
    SELECT o.cis_pk, (SELECT COUNT(*) FROM package_sessions ps
       JOIN packages p ON p.id=ps.package_id
       WHERE ps.check_in_id=o.check_in_id AND p.customer_id=o.customer_id AND ps.deleted_at IS NULL) AS ps_cnt
    FROM orphans o) x;`);

// STEP2: per-orphan candidate count with session_type match + not-already-linked (exact anchor)
// mapping: service_name -> session_type
out.partition = await q(`
  WITH map AS (
    SELECT * FROM (VALUES
      ('비가열성 진균증 레이저 치료','unheated_laser'),
      ('가열성 진균증 레이저 치료','heated_laser'),
      ('포돌로게(내성발톱 치료의료기기)','podologue'),
      ('비가열레이저 - AF','unheated_laser')
    ) AS m(service_name, session_type)),
  orphans AS (
    SELECT cis.id cis_pk, cis.check_in_id, cis.service_name, cis.service_id, ci.customer_id,
           (SELECT session_type FROM map WHERE map.service_name=cis.service_name) AS mapped_st
    FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
    WHERE cis.is_package_session=true AND cis.package_session_id IS NULL),
  cand AS (
    SELECT o.cis_pk, o.mapped_st, ps.id ps_id, ps.session_type, ps.status,
      -- is this ps already claimed by a (healthy) cis?
      EXISTS(SELECT 1 FROM check_in_services c2 WHERE c2.package_session_id=ps.id) AS ps_claimed
    FROM orphans o
    JOIN packages p ON p.customer_id=o.customer_id
    JOIN package_sessions ps ON ps.package_id=p.id AND ps.check_in_id=o.check_in_id AND ps.deleted_at IS NULL)
  SELECT
    o.cis_pk,
    o.service_name,
    o.mapped_st,
    COUNT(c.ps_id) AS cand_all,
    COUNT(c.ps_id) FILTER (WHERE c.session_type=o.mapped_st) AS cand_typematch,
    COUNT(c.ps_id) FILTER (WHERE c.session_type=o.mapped_st AND NOT c.ps_claimed) AS cand_typematch_unclaimed
  FROM orphans o LEFT JOIN cand c ON c.cis_pk=o.cis_pk
  GROUP BY o.cis_pk, o.service_name, o.mapped_st
  ORDER BY cand_typematch_unclaimed DESC, cand_all DESC;`);

// summary of partition
const rows=out.partition;
const summary={A_resolvable:0,B_ambiguous:0,B_absent:0};
for(const r of rows){
  const c=Number(r.cand_typematch_unclaimed);
  if(c===1) summary.A_resolvable++;
  else if(c>=2) summary.B_ambiguous++;
  else summary.B_absent++;
}
out.partition_summary=summary;
console.log(JSON.stringify(out,null,2));

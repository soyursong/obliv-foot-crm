/**
 * READ-ONLY introspection probe v2 (no persistence, no DDL).
 * T-20260720-xcrm-AICC-ANON-PII-RELATION-SWEEP — foot lane.
 * Focus: aicc_crm_phone_match (VIEW, the real PII surface in foot) + customers policies + usage-baseline.
 */
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) return { __error: `${r.status} ${await r.text()}` };
  return r.json();
}
const p = (label, rows) => { console.log(`\n===== ${label} =====`); console.log(JSON.stringify(rows, null, 2)); };

// A. view definition — what columns/PII does aicc_crm_phone_match expose, security_invoker?
p('A. aicc_crm_phone_match view definition', await q(`
  SELECT pg_get_viewdef('public.aicc_crm_phone_match'::regclass, true) AS viewdef;`));
p('A2. view reloptions (security_invoker / security_barrier)', await q(`
  SELECT c.reloptions FROM pg_class c WHERE c.oid='public.aicc_crm_phone_match'::regclass;`));
p('A3. view columns', await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='aicc_crm_phone_match' ORDER BY ordinal_position;`));

// B. customers policies (anon/public focus) + rls state
p('B. customers rls state', await q(`
  SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
  FROM pg_class WHERE oid='public.customers'::regclass;`));
p('B2. customers policies (all, with roles + USING)', await q(`
  SELECT polname, polcmd,
         CASE polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS mode,
         ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles,
         pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
         pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
  FROM pg_policy pol WHERE pol.polrelid='public.customers'::regclass ORDER BY polname;`));
p('B3. customers anon/public grants', await q(`
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_name='customers' AND table_schema='public'
    AND grantee IN ('anon','public') ORDER BY grantee, privilege_type;`));

// C. usage-baseline — pg_stat_statements
p('C. pg_stat_statements installed?', await q(`
  SELECT count(*) AS n FROM pg_extension WHERE extname='pg_stat_statements';`));
p('C2. pgss query matches on aicc_crm_phone_match (by role)', await q(`
  SELECT rolname, sum(s.calls) AS calls, max(left(s.query,160)) AS sample
  FROM pg_stat_statements s JOIN pg_roles r ON r.oid=s.userid
  WHERE s.query ILIKE '%aicc_crm_phone_match%'
  GROUP BY rolname ORDER BY calls DESC;`));
p('C3. pgss stats reset time / total rows', await q(`
  SELECT stats_reset FROM pg_stat_statements_info;`));

// D. underlying table the view reads (to sanity-check anon path) — from viewdef we infer; also count of anon-executable
p('D. all relations with anon SELECT that expose name+phone columns (broad PII sweep)', await q(`
  SELECT g.table_name, string_agg(DISTINCT col.column_name, ',') AS pii_cols
  FROM information_schema.role_table_grants g
  JOIN information_schema.columns col
    ON col.table_schema=g.table_schema AND col.table_name=g.table_name
  WHERE g.grantee='anon' AND g.privilege_type='SELECT' AND g.table_schema='public'
    AND col.column_name IN ('name','phone','patient_name','customer_name','phone_number')
  GROUP BY g.table_name ORDER BY g.table_name;`));

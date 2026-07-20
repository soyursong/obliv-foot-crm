// T-20260720-foot-AICC-PHONEMATCH-SECINVOKER-CONFIRM — reproducible read-only introspect
//
// Purpose: independently verify the security_invoker posture of the
//          public.aicc_crm_phone_match view + the RLS backing that makes
//          the "no-op (compliant)" verdict safe.
//
// SAFETY: read-only. Issues ONLY SELECT / catalog introspection. No DDL, no DML.
//
// Usage (any operator, incl. supervisor, can reproduce):
//   1. Ensure obliv-foot-crm/.env.local contains SUPABASE_ACCESS_TOKEN
//      (Supabase Management API personal access token, read scope sufficient).
//   2. node scripts/introspect_aicc_phonematch.mjs
//
// Project ref (foot prod): rxlomoozakkjesdqjtvd
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV = resolve(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOK) { console.error('MISSING SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(2); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('════ AICC_CRM_PHONE_MATCH INTROSPECT (read-only) ════\n');

// [1] view existence + owner + reloptions (security_invoker)
const meta = await q(`
  SELECT c.relname, n.nspname AS schema, pg_get_userbyid(c.relowner) AS owner,
         c.relkind, c.reloptions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'aicc_crm_phone_match'`);
console.log('[1] relation meta:', JSON.stringify(meta, null, 2));

if (meta.length === 0) { console.log('\n>>> RESULT: RELATION ABSENT -> closed (해당없음)'); process.exit(0); }

const reloptions = meta[0].reloptions;
const si = reloptions ? reloptions.find((o) => o.startsWith('security_invoker')) : null;
console.log('\n[1b] reloptions =', reloptions);
console.log('[1b] security_invoker option =', si || '(미설정)');

// [2] view definition
const def = await q(`SELECT pg_get_viewdef('public.aicc_crm_phone_match'::regclass, true) AS ddl`);
console.log('\n[2] view definition:\n', def[0].ddl);

// [3] RLS backing on the underlying customers table — proves clinic-scope
//     enforcement when the view reads with invoker rights.
const rls = await q(`
  SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'customers'`);
console.log('\n[3] customers RLS status:', JSON.stringify(rls, null, 2));

const policies = await q(`
  SELECT polname, cmd, roles, qual
  FROM (
    SELECT p.polname,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                         WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
           ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)) AS roles,
           pg_get_expr(p.polqual, p.polrelid) AS qual
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'customers'
  ) s
  ORDER BY cmd, polname`);
console.log('\n[3b] customers RLS policies:', JSON.stringify(policies, null, 2));

// posture verdict
let verdict;
if (si && /security_invoker=(on|true)/i.test(si)) verdict = 'ON (COMPLIANT) -> no-op closed';
else verdict = 'OFF/미설정 (VULNERABLE) -> proceed to regression evidence (§4-b)';
console.log('\n>>> POSTURE VERDICT:', verdict);

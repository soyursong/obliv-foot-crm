import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};
out.def = await q(`SELECT pg_get_functiondef(p.oid) def, md5(pg_get_functiondef(p.oid)) md5,
  p.provolatile, p.prosecdef, p.proconfig,
  pg_get_function_result(p.oid) result,
  pg_get_function_arguments(p.oid) args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`);
out.grants = await q(`SELECT grantee, privilege_type FROM information_schema.routine_privileges
  WHERE routine_schema='public' AND routine_name='foot_stats_revenue' ORDER BY grantee;`).catch(e=>({error:String(e)}));
out.comment = await q(`SELECT obj_description(p.oid) c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`).catch(e=>({error:String(e)}));
out.ledger = await q(`SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260719140000','20260719160000') ORDER BY version;`).catch(e=>({error:String(e)}));
console.log(JSON.stringify(out, null, 2));

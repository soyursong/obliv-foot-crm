/**
 * T-20260819-foot-REFUND-CROSSMETHOD — C19 fwdfix rebase: pull CURRENT prod RPC defs (READ-ONLY)
 * FIX-REQUEST MSG-20260819-105120 (supervisor): rebase 3 refund RPC on LIVE prod, not stale ancestor.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const fns = ['refund_package_payment','refund_single_payment','refund_package_atomic'];
for (const fn of fns){
  const rows = await q(`SELECT p.oid::regprocedure AS sig, pg_get_functiondef(p.oid) AS def,
    (position('SET status' in pg_get_functiondef(p.oid))>0) AS has_setstatus,
    (position('created_by' in pg_get_functiondef(p.oid))>0) AS has_created_by,
    (position('auth.uid()' in pg_get_functiondef(p.oid))>0) AS has_authuid
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='${fn}';`);
  console.log(`\n================ ${fn} (${rows.length} overload) ================`);
  for(const row of rows){
    console.log(`--- SIG: ${row.sig} | has_setstatus=${row.has_setstatus} has_created_by=${row.has_created_by} has_authuid=${row.has_authuid}`);
    console.log(row.def);
  }
}

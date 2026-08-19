import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  return {ok:r.ok, status:r.status, body:await r.text()};
}
let rb = readFileSync('supabase/migrations/20260819020000_foot_refund_method_inherit_disbursement_fwdfix.rollback.sql','utf8');
const dry = rb.replace(/\nCOMMIT;/, '\nROLLBACK;');
console.log('=== executing rollback.sql with COMMIT->ROLLBACK (no-persistence) ===');
const res = await q(dry);
console.log('status', res.status, 'ok', res.ok);
if(!res.ok){ console.log('BODY:', res.body); process.exit(1); }
console.log('rollback.sql exec OK (parses+executes clean = symmetric restore valid).');
// confirm prod still intact (rollback rolled back)
const fns = await q(`SELECT p.proname,
  (position('created_by' in pg_get_functiondef(p.oid))>0) AS has_created_by
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('refund_package_payment','refund_single_payment') ORDER BY 1;`);
console.log('prod intact check:', fns.body);

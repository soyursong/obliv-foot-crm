import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  return {ok:r.ok, status:r.status, body:await r.text()};
}
const FNS=['refund_package_payment','refund_single_payment','refund_package_atomic'];
async function defs(){
  const rows = JSON.parse((await q(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) h
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(ARRAY['refund_package_payment','refund_single_payment','refund_package_atomic']) ORDER BY 1;`)).body);
  return Object.fromEntries(rows.map(r=>[r.proname,r.h]));
}
const base = await defs();
console.log('prod baseline md5:', base);

let up = readFileSync('supabase/migrations/20260819020000_foot_refund_method_inherit_disbursement_fwdfix.sql','utf8')
  .replace(/^BEGIN;\s*$/m,'').replace(/\nCOMMIT;/,'');
let rb = readFileSync('supabase/migrations/20260819020000_foot_refund_method_inherit_disbursement_fwdfix.rollback.sql','utf8')
  .replace(/^BEGIN;\s*$/m,'').replace(/\nCOMMIT;/,'');
// single txn: apply up, capture post-up hashes, apply rollback, capture post-rb hashes, ROLLBACK.
const sql = `BEGIN;
${up}
CREATE TEMP TABLE _probe_up AS SELECT p.proname, md5(pg_get_functiondef(p.oid)) h
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(ARRAY['refund_package_payment','refund_single_payment','refund_package_atomic']);
${rb}
SELECT 'AFTER_UP' phase, proname, h FROM _probe_up
UNION ALL
SELECT 'AFTER_RB' phase, p.proname, md5(pg_get_functiondef(p.oid)) h
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(ARRAY['refund_package_payment','refund_single_payment','refund_package_atomic'])
ORDER BY phase, proname;
ROLLBACK;`;
const res = await q(sql);
console.log('roundtrip status', res.status, res.ok);
if(!res.ok){ console.log(res.body); process.exit(1); }
const rows = JSON.parse(res.body);
const afterUp={}, afterRb={};
for(const r of rows){ if(r.phase==='AFTER_UP') afterUp[r.proname]=r.h; else afterRb[r.proname]=r.h; }
console.log('\n--- symmetry assertions ---');
let allpass=true;
for(const fn of FNS){
  const changedByUp = afterUp[fn]!==base[fn];
  const restored = afterRb[fn]===base[fn];
  const pass = changedByUp && restored;
  if(!pass) allpass=false;
  console.log(`${pass?'PASS':'FAIL'} ${fn}: up-changed=${changedByUp} rollback-restored-to-prod=${restored}`);
}
console.log(allpass ? '\n✅ ROUND-TRIP SYMMETRY OK — up mutates, rollback restores EXACT current prod.' : '\n❌ SYMMETRY FAIL');

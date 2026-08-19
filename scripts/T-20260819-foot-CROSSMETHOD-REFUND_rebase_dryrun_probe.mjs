/**
 * T-20260819-foot-REFUND-CROSSMETHOD — C19 rebase up.sql no-persistence dry-run probe.
 * up.sql 의 trailing COMMIT 을 ROLLBACK 으로 치환하여 무영속 실행(parse+execute, 영속 0).
 * 검증: 실행 성공(에러 0) + 사후 refund_disbursement_method 컬럼 부재(영속 0 = sentinel-bypass 없음).
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  return {ok:r.ok, status:r.status, body:t};
}
let up = readFileSync('supabase/migrations/20260819020000_foot_refund_method_inherit_disbursement_fwdfix.sql','utf8');
// swap the transaction terminator: COMMIT; -> ROLLBACK;  (no-persistence guarantee)
if (up.match(/\nCOMMIT;/)===null){ console.error('NO COMMIT; found — abort'); process.exit(1); }
const dry = up.replace(/\nCOMMIT;/, '\nROLLBACK;');
console.log('=== executing up.sql with COMMIT->ROLLBACK (no-persistence) ===');
const res = await q(dry);
console.log('status', res.status, 'ok', res.ok);
if(!res.ok){ console.log('BODY:', res.body); process.exit(1); }
console.log('exec OK (no error).');
// post-check: columns must be ABSENT (proof of rollback / no sentinel-bypass)
const chk = await q(`SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='refund_disbursement_method' ORDER BY 1;`);
console.log('post-persist column check (expect EMPTY):', chk.body);
// post-check: prod RPC bodies unchanged (has_created_by still true, atomic still setstatus)
const fns = await q(`SELECT p.proname,
  (position('created_by' in pg_get_functiondef(p.oid))>0) AS has_created_by,
  (position('SET status' in pg_get_functiondef(p.oid))>0 OR position('SET status =' in pg_get_functiondef(p.oid))>0) AS has_setstatus
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('refund_package_payment','refund_single_payment','refund_package_atomic') ORDER BY 1;`);
console.log('post-persist prod RPC unchanged check:', fns.body);

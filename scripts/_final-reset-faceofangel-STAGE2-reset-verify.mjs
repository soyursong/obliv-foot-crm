/**
 * T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL — FINAL controlled reset (THE FINAL RESET, no #4)
 * Single atomic run: identity re-verify -> reset to KNOWN value -> login-verify with SAME variable.
 * 3-way match (set==relay==login) structurally guaranteed: NEWPW is one variable used for both set & login.
 * Password via env NEWPW (never committed). DRY_RUN=false to apply.
 */
import { createClient } from '@supabase/supabase-js';
const URL='https://rxlomoozakkjesdqjtvd.supabase.co';
const SRK=process.env.SUPABASE_SERVICE_ROLE_KEY||(()=>{throw new Error('SRK req')})();
const ANON=process.env.VITE_SUPABASE_ANON_KEY||(()=>{throw new Error('ANON req')})();
const NEWPW=process.env.NEWPW||(()=>{throw new Error('NEWPW env required (known value, no fallback)')})();
const TARGET_ID='b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const TARGET_EMAIL='faceofangel9999@oblivseoul.kr';
const DRY_RUN=process.env.DRY_RUN!=='false';
const admin=createClient(URL,SRK,{auth:{persistSession:false}});

// C2 identity re-verify (id-based, single-match) — abort on mismatch
const {data:byId,error:e1}=await admin.auth.admin.getUserById(TARGET_ID);
if(e1){console.error('ABORT getUserById:',e1.message);process.exit(2);}
const idEmail=byId.user?.email||null;
if(!idEmail||idEmail.toLowerCase()!==TARGET_EMAIL.toLowerCase()){
  console.error(`ABORT identity mismatch: ${idEmail} != ${TARGET_EMAIL}`);process.exit(2);}
console.log('C2 identity re-verify: PASS',TARGET_ID,'<->',idEmail);

if(DRY_RUN){console.log('DRY-RUN: would set password (masked:',NEWPW.replace(/./g,'*'),') len=',NEWPW.length,'-> apply with DRY_RUN=false');process.exit(0);}

// C3 FINAL single reset (email_confirm:true to keep confirmed; approved/active untouched)
const {data:upd,error:e2}=await admin.auth.admin.updateUserById(TARGET_ID,{password:NEWPW,email_confirm:true});
if(e2){console.error('ABORT reset failed (NO retry, escalate):',e2.message);process.exit(1);}
console.log('RESET OK. email_confirmed_at=',upd.user.email_confirmed_at);

// C4 login-verify with the SAME variable (guarantees set==login)
const client=createClient(URL,ANON,{auth:{persistSession:false}});
const {data:si,error:e3}=await client.auth.signInWithPassword({email:TARGET_EMAIL,password:NEWPW});
if(e3){console.error('ABORT login-verify FAILED after reset:',e3.status,e3.message,'-> escalate');process.exit(3);}
const ok = !!si.session && si.user?.id===TARGET_ID;
console.log('LOGIN-VERIFY: auth', si.session?200:'?','session=',!!si.session,'user.id==target=',si.user?.id===TARGET_ID,'role=',si.user?.user_metadata?.role||'(meta n/a)');
await client.auth.signOut();
if(!ok){console.error('ABORT: session/user mismatch');process.exit(3);}
console.log('\n=== 3-WAY MATCH EVIDENCE ===');
console.log('SET value        == NEWPW variable (single process)');
console.log('LOGIN-OK value   == same NEWPW variable => 200 session issued for target id');
console.log('RELAY value      == printed below (I copy to responder relay verbatim)');
console.log('NEWPW(verbatim)  :',NEWPW);
console.log('STAGE2 DONE — THIS IS THE FINAL RESET.');

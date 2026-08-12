/**
 * T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID — POST-VERIFY (READ-ONLY)
 *   GO-token post-verify 4항:
 *     (a) 대상 3행 status=cancelled·cancelled_by=이 티켓
 *     (b) v_daily_revenue 08-04 single Δ +270,400 (3,580,600→3,851,000) + net 25,921,000
 *     (c) 08-03 Group B 270,400 불변 (5c642195=260,000 + 88e504d0=10,400 active·무접촉)
 *     (d) phantom 3행 무접촉 (still MATAEMIN-ROLLBACK)
 *   + schema_migrations 20260812150000 등재 확인.
 *   write 0. Management API `/database/query` (ref rxlomoozakkjesdqjtvd).
 */
import fs from 'fs';
const REF='rxlomoozakkjesdqjtvd';
const TARGETS=['2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'];
const PHANTOMS=['d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','9d8c6f77-dbe0-40c1-a024-5b33b23fb035'];
const GROUPB=['5c642195','88e504d0']; // 08-03 실카드 실승인 (prefix)
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const THIS_BY='dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID';
const MATAEMIN_BY='dev-foot:T-20260804-MATAEMIN-ROLLBACK';

let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN&&fs.existsSync('.env.local')){for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);if(m)TOKEN=m[1].trim().replace(/^["']|["']$/g,'');}}
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 미제공');process.exit(1);}
async function qj(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const uarr=a=>`ARRAY[${a.map(x=>`'${x}'`).join(',')}]::uuid[]`;

const ev={ticket:'T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID',phase:'post-verify',ref:REF,ts:new Date().toISOString(),checks:{}};
let ok=true;const fail=(k,m)=>{ok=false;console.log(`❌ ${k}: ${m}`);};const pass=(k,m)=>console.log(`✅ ${k}: ${m}`);
try{
  console.log(`── POST-VERIFY (READ-ONLY, ref ${REF}) ──\n`);

  // (a) 대상 3행 cancelled by this ticket
  const t=await qj(`SELECT id::text,status,cancelled_by,cancelled_at::text,amount,service_charge_id::text FROM public.payments WHERE id=ANY(${uarr(TARGETS)}) ORDER BY amount`);
  ev.checks.a_targets=t;
  const aOk=t.length===3&&t.every(r=>r.status==='cancelled'&&r.cancelled_by===THIS_BY&&r.service_charge_id===null);
  if(aOk)pass('(a) 대상3행',`전부 cancelled by 이 티켓·service_charge_id NULL(SSOT firewall)·sum=${t.reduce((s,r)=>s+Number(r.amount),0)}·cancelled_at=${t[0].cancelled_at}`);
  else fail('(a) 대상3행',JSON.stringify(t));

  // (b) v_daily_revenue 08-04
  const v4=await qj(`SELECT single_revenue,package_revenue,net_revenue FROM public.v_daily_revenue WHERE dt='2026-08-04' AND clinic_id='${CLINIC}'`);
  ev.checks.b_vrev_0804=v4;
  const bOk=v4.length===1&&Number(v4[0].single_revenue)===3851000&&Number(v4[0].net_revenue)===25921000;
  if(bOk)pass('(b) 08-04 매출',`single=${v4[0].single_revenue}(3,580,600→3,851,000 Δ+270,400)·package=${v4[0].package_revenue}·net=${v4[0].net_revenue}(=25,921,000)`);
  else fail('(b) 08-04 매출',JSON.stringify(v4));

  // (c) 08-03 Group B 불변
  const gb=await qj(`SELECT id::text,status,amount,cancelled_by,created_at::text FROM public.payments
    WHERE (id::text LIKE '5c642195%' OR id::text LIKE '88e504d0%') ORDER BY amount DESC`);
  ev.checks.c_groupb=gb;
  const gbSum=gb.reduce((s,r)=>s+Number(r.amount),0);
  const cOk=gb.length===2&&gb.every(r=>r.status==='active'&&r.cancelled_by===null)&&gbSum===270400;
  if(cOk)pass('(c) 08-03 GroupB',`2행 active·무접촉(cancelled_by NULL)·sum=${gbSum}(=270,400 불변)`);
  else fail('(c) 08-03 GroupB',JSON.stringify(gb));

  // (d) phantom 무접촉
  const p=await qj(`SELECT id::text,status,cancelled_by FROM public.payments WHERE id=ANY(${uarr(PHANTOMS)})`);
  ev.checks.d_phantoms=p;
  const dOk=p.length===3&&p.every(r=>r.status==='cancelled'&&r.cancelled_by===MATAEMIN_BY);
  if(dOk)pass('(d) phantom3행',`전부 cancelled by MATAEMIN-ROLLBACK (이 티켓 무접촉)`);
  else fail('(d) phantom3행',JSON.stringify(p));

  // schema_migrations 등재
  const reg=await qj(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20260812150000'`);
  ev.checks.schema_migrations=reg;
  if(reg.length===1)pass('원장등재',`schema_migrations 20260812150000=${reg[0].name}`);
  else fail('원장등재','20260812150000 미등재');

}catch(e){ok=false;ev.error=e.message;console.error(`\n❌ 예외: ${e.message}`);}
ev.verdict=ok?'PASS — soft-void terminal state 확정':'FAIL';
fs.writeFileSync('scripts/T-20260811-foot-FIX2B-SOFTVOID_postverify.out.json',JSON.stringify(ev,null,2));
console.log(`\n${ok?'✅ POST-VERIFY PASS — soft-void terminal state 확정':'🛑 POST-VERIFY FAIL'}`);
process.exit(ok?0:2);

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env={...loadEnv(new URL("../.env.local",import.meta.url).pathname),...process.env};
const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||"https://rxlomoozakkjesdqjtvd.supabase.co",env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const KST=(iso)=>iso?new Date(new Date(iso).getTime()+9*3600e3).toISOString().slice(11,19):null;
// 8/4 16:00 KST ~ 8/5 00:00 KST
const lo="2026-08-04T07:00:00Z", hi="2026-08-04T15:00:00Z";
const {data:pays}=await db.from("payments")
  .select("id, amount, payment_type, deleted_at, external_approval_no, external_trxid, reconciled_at, created_at, memo, customer_id")
  .eq("method","card").gte("created_at",lo).lt("created_at",hi).order("created_at",{ascending:true});
const active=(pays||[]).filter(p=>!p.deleted_at);
const payment=active.filter(p=>p.payment_type==="payment");
const refund=active.filter(p=>p.payment_type==="refund");
const van=payment.filter(p=>p.external_approval_no);
const manual=payment.filter(p=>!p.external_approval_no);
const groups={};for(const p of active){if(!p.external_approval_no)continue;const k=`${p.external_approval_no}|${p.amount}|${p.payment_type}`;(groups[k]=groups[k]||[]).push(p.id);}
const dup=Object.entries(groups).filter(([,v])=>v.length>1);
const sum=a=>a.reduce((s,p)=>s+Number(p.amount),0);
console.log(JSON.stringify({
  window:"8/4 16:00~24:00 KST (8/4 only, matches RedPay baseline day)",
  active_card_rows:active.length, payment_rows:payment.length, refund_rows:refund.length,
  "(c)_van_routed(HAS AUTHNO)":van.length, van_sum:sum(van),
  "(b)_manual_null_approval":manual.length, manual_sum:sum(manual),
  "(a)_refund_cancel_legs":refund.length, refund_detail:refund.map(r=>({amt:r.amount,authno:r.external_approval_no,memo:r.memo,kst:KST(r.created_at)})),
  "(d)_dup_groups_UNEXPLAINED":dup.length, dup_detail:dup,
  van_authnos:van.map(p=>p.external_approval_no),
  manual_detail:manual.map(p=>({amt:p.amount,cust:(p.customer_id||"").slice(0,8),memo:p.memo,kst:KST(p.created_at)})),
},null,2));

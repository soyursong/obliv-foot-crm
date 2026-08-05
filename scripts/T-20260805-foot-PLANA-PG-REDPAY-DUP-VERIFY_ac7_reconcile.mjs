// T-20260805 AC-7 — CRM card payments 26 → RedPay 19 AUTHNO 1:1 대조 (READ-ONLY)
// ⛔ SELECT only. write/update/delete 0.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env={...loadEnv(new URL("../.env.local",import.meta.url).pathname),...process.env};
const URL_=env.SUPABASE_URL||env.VITE_SUPABASE_URL||"https://rxlomoozakkjesdqjtvd.supabase.co";
const KEY=env.SUPABASE_SERVICE_ROLE_KEY;
if(!KEY){console.error("NO SERVICE_ROLE_KEY");process.exit(1);}
const db=createClient(URL_,KEY,{auth:{persistSession:false}});
const KST=(iso)=>iso?new Date(new Date(iso).getTime()+9*3600e3).toISOString().replace("T"," ").slice(11,19):null;
const winStartUtc="2026-08-04T07:00:00Z"; // 8/4 16:00 KST

const {data:pays,error}=await db.from("payments")
  .select("id, amount, method, payment_type, status, deleted_at, external_approval_no, external_trxid, external_tid, reconciled_at, payment_attempt_id, accounting_date, created_at, memo, customer_id")
  .eq("method","card").gte("created_at",winStartUtc).order("created_at",{ascending:true});
if(error){console.error(error.message);process.exit(1);}
const active=(pays||[]).filter(p=>!p.deleted_at);

const payment=active.filter(p=>p.payment_type==="payment");
const refund =active.filter(p=>p.payment_type==="refund");
const other  =active.filter(p=>!["payment","refund"].includes(p.payment_type));

// classify payment rows
const vanRouted = payment.filter(p=>p.external_approval_no);       // has AUTHNO = VAN/RedPay-routed
const manualNull= payment.filter(p=>!p.external_approval_no);      // AUTHNO NULL = 수기 manual (VAN 미경유)
const distinctAuthno=[...new Set(vanRouted.map(p=>p.external_approval_no))];

// dup group check: (approval_no, amount, payment_type) collision among active
const groups={};
for(const p of active){ if(!p.external_approval_no)continue; const k=`${p.external_approval_no}|${p.amount}|${p.payment_type}`; (groups[k]=groups[k]||[]).push(p.id);}
const dupGroups=Object.entries(groups).filter(([,v])=>v.length>1);

// manual dup (중복 memo refunds + null-approval payment clusters by customer+amount)
const manualClusters={};
for(const p of manualNull){const k=`${p.customer_id}|${p.amount}`;(manualClusters[k]=manualClusters[k]||[]).push(p.id);}
const manualDupClusters=Object.entries(manualClusters).filter(([,v])=>v.length>1);

const dupRefunds=refund.filter(r=>(r.memo||"").includes("중복"));

const report={
  ts_kst_generated:"regen",
  window:"2026-08-04 16:00 KST ~ now",
  total_active_card_rows:active.length,
  breakdown:{payment:payment.length, refund:refund.length, other:other.length},
  classification:{
    "(c)_van_routed_payment_HAS_AUTHNO":vanRouted.length,
    distinct_authno_among_van:distinctAuthno.length,
    "(b)_manual_null_approval_payment":manualNull.length,
    "(a)_refund_cancel_leg_rows":refund.length,
  },
  dup_groups_authno_amount_type:dupGroups.length,
  dup_group_detail:dupGroups,
  manual_dup_clusters_customer_amount:manualDupClusters.length,
  manual_dup_cluster_detail:manualDupClusters.map(([k,v])=>({key:k,ids:v})),
  staff_correction_refunds_중복:dupRefunds.map(r=>({id:r.id,amount:r.amount,cust:r.customer_id,created_kst:KST(r.created_at)})),
  van_routed_authno_list:vanRouted.map(p=>({authno:p.external_approval_no,amount:p.amount,trxid:p.external_trxid,recon:!!p.reconciled_at,created_kst:KST(p.created_at)})),
  manual_null_list:manualNull.map(p=>({id:p.id.slice(0,8),amount:p.amount,cust:(p.customer_id||"").slice(0,8),created_kst:KST(p.created_at),memo:p.memo})),
};
console.log(JSON.stringify(report,null,2));

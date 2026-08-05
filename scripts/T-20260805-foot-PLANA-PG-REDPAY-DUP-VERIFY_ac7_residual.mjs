import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env={...loadEnv(new URL("../.env.local",import.meta.url).pathname),...process.env};
const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||"https://rxlomoozakkjesdqjtvd.supabase.co",env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const KST=(iso)=>iso?new Date(new Date(iso).getTime()+9*3600e3).toISOString().slice(11,19):null;
const lo="2026-08-04T07:00:00Z", hi="2026-08-04T15:00:00Z";
// deleted card rows in window
const {data:del}=await db.from("payments").select("id,amount,payment_type,external_approval_no,deleted_at,created_at,memo").eq("method","card").gte("created_at",lo).lt("created_at",hi).not("deleted_at","is",null);
// redpay raw approvals (status Y) in 8/4 window
const {data:raws}=await db.from("redpay_raw_transactions").select("approval_no,external_status,amount,approved_at,matched_payment_id,pg_type").gte("approved_at",lo).lt("approved_at",hi).order("approved_at",{ascending:true});
const yRaws=(raws||[]).filter(r=>r.external_status==="Y");
console.log(JSON.stringify({
  deleted_card_rows_in_window: (del||[]).map(d=>({amt:d.amount,type:d.payment_type,authno:d.external_approval_no,memo:d.memo,kst:KST(d.created_at)})),
  redpay_Y_raw_count: yRaws.length,
  redpay_Y_raw: yRaws.map(r=>({authno:r.approval_no,amt:r.amount,pg:r.pg_type,matched:!!r.matched_payment_id,kst:KST(r.approved_at)})),
},null,2));

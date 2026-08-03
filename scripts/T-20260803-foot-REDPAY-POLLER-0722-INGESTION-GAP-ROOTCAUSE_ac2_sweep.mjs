// READ-ONLY AC-2 systemic sweep (feed↔raw count-first delta1). No DB write.
import { readFileSync } from "node:fs"; import { homedir } from "node:os"; import { join } from "node:path";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}catch{}return o;}
const e={...loadEnv(join(homedir(),".env.redpay")),...loadEnv(join(homedir(),".env.redpay-foot"))};
const KEY=e.REDPAY_API_KEY, SB=e.SUPABASE_URL||"https://rxlomoozakkjesdqjtvd.supabase.co", SR=e.SUPABASE_SERVICE_ROLE_KEY;
const BIZ="457-23-00938"; // 현행 — flip 후 전 이력이 여기로 귀속
const FOOT=new Set(["1777289012","1777289001","1777289002","1777289003","1777289004","1777289005","1777289006","1777289007","1777289008","1777289009","1777289010","1777289011","1777289013","1777285001","1777285002","1777285003","1777285004","1777285005","1777285006","1777285007","1777285008","1777288001","1777288003","1777288004","1777288005","1777288006","1777288008"]);
const H={apikey:SR,Authorization:`Bearer ${SR}`};
const CLINIC="74967aea-a60b-4da3-a0e7-9c997a930bc8";
async function feed(day){const p=new URLSearchParams({from:day,to:day,business_no:BIZ,page:"1",limit:"500"});const r=await fetch(`https://redpay.kr/api/partner/payments.php?${p}`,{headers:{"X-API-KEY":KEY}});if(!(r.headers.get("Content-Type")||"").includes("json"))return{cnt:0,net:0,tids:new Set()};const j=await r.json();const items=(j.data?.items??[]).filter(it=>{const m=it.merchant?.id!=null?String(it.merchant.id):null;return m&&FOOT.has(m);});let net=0;const tids=new Set();for(const it of items){net+=Number(it.amount||0);tids.add(String(it.tid));}return{cnt:items.length,net,tids};}
async function raw(day){ // day KST -> UTC window
  const from=new Date(`${day}T00:00:00+09:00`).toISOString(), to=new Date(`${day}T00:00:00+09:00`);to.setDate(to.getDate()+1);
  const q=`redpay_raw_transactions?clinic_id=eq.${CLINIC}&approved_at=gte.${from}&approved_at=lt.${to.toISOString()}&select=external_trxid,amount,tid`;
  const r=await fetch(`${SB}/rest/v1/${q}`,{headers:H});const rows=await r.json();let net=0;for(const x of rows)net+=Number(x.amount||0);return{cnt:rows.length,net};}
const days=[];for(let d=11;d<=31;d++)days.push(`2026-07-${String(d).padStart(2,"0")}`);for(let d=1;d<=2;d++)days.push(`2026-08-0${d}`);
console.log("day        feed_cnt feed_net    raw_cnt raw_net     Δcnt  verdict");
let gaps=[];
for(const day of days){const f=await feed(day),g=await raw(day);const dc=f.cnt-g.cnt;const v=dc>0?"⚠UNDER-INGEST":dc<0?"raw>feed(ok)":"ok";if(dc>0)gaps.push({day,dc,tids:[...f.tids]});
  console.log(`${day} ${String(f.cnt).padStart(6)} ${String(f.net).padStart(11)} ${String(g.cnt).padStart(8)} ${String(g.net).padStart(11)} ${String(dc).padStart(5)}  ${v}`);}
console.log("\n=== UNDER-INGESTION 요약 ===");
if(!gaps.length)console.log("  없음 — 07-22 외 systemic 미적재 0 (feed≤raw 전일 정합)");
else for(const x of gaps)console.log(`  ${x.day}: Δ${x.dc}건, feed TID=[${x.tids.join(",")}]`);

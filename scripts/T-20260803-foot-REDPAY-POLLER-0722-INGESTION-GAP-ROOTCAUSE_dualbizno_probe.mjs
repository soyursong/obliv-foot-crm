// READ-ONLY probe (T-20260803-foot-REDPAY-POLLER-0722-INGESTION-GAP-ROOTCAUSE AC-1)
// RedPay 조회API GET only. DB write 0. 목적: 07-22 2건이 어느 business_no 버킷에 있는지 확정.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}catch{}return o;}
const e={...loadEnv(join(homedir(),".env.redpay")),...loadEnv(join(homedir(),".env.redpay-foot"))};
const KEY=e.REDPAY_API_KEY;
const URL_="https://redpay.kr/api/partner/payments.php";
const BIZ={"457-23-00938":"NEW(현행)","511-60-00988":"OLD(구,flip전)"};
const FOOT=new Set(["1777289012","1777289001","1777289002","1777289003","1777289004","1777289005","1777289006","1777289007","1777289008","1777289009","1777289010","1777289011","1777289013","1777285001","1777285002","1777285003","1777285004","1777285005","1777285006","1777285007","1777285008","1777288001","1777288003","1777288004","1777288005","1777288006","1777288008"]);
async function pull(biz,day){
  const p=new URLSearchParams({from:day,to:day,business_no:biz,page:"1",limit:"500"});
  const r=await fetch(`${URL_}?${p}`,{headers:{"X-API-KEY":KEY}});
  const ct=r.headers.get("Content-Type")||"";
  if(!ct.toLowerCase().includes("json"))return{err:`non-JSON status=${r.status}`};
  const j=await r.json();
  if(!j.success)return{err:`success=false msg=${j.message}`};
  const items=j.data?.items??[];
  let foot=0,footNet=0,tgt=0;const tgtRows=[];
  for(const it of items){const mid=it.merchant?.id!=null?String(it.merchant.id):null;
    if(mid&&FOOT.has(mid)){foot++;footNet+=Number(it.amount||0);}
    if(mid==="1777289012"){tgt++;tgtRows.push(`status=${it.status} amt=${it.amount} trx=${it.trxid} tid=${it.tid} appr=${it.approved_at}`);}}
  return{total:items.length,foot,footNet,tgt,tgtRows};
}
for(const day of ["2026-07-22","2026-07-20"]){
  console.log(`\n════ date=${day} ════`);
  for(const biz of Object.keys(BIZ)){
    const res=await pull(biz,day);
    if(res.err){console.log(`  ${biz} ${BIZ[biz]}: ERR ${res.err}`);continue;}
    console.log(`  ${biz} ${BIZ[biz]}: feed_total=${res.total} foot=${res.foot} footNet=${res.footNet} merchant1777289012=${res.tgt}건`);
    res.tgtRows.forEach(x=>console.log(`      · ${x}`));
  }
}

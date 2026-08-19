/**
 * T-20260819-foot-SETTLEMENT-CATEGORY-CHART2-MERGE-WALKIN — 비-PHI 집계 (READ-ONLY)
 * FIX-REQUEST MSG-20260820-083357-syri (parent ms60/yp7n).
 * §비-PHI 답: 6항목(처방약·상병·처방·기타·풋케어단건·프리컨디셔닝) 카테고리별 건수 + 최근 날짜.
 * ★ 실명/차트/연락처 미조회 — PHI 0. DB WRITE 0 (service_role READ only).
 * 카테고리 linkage = foot_stats_by_category RPC 정본 재사용:
 *   single_paid: payments → check_in_services → services.category (accounting_date 축)
 *   preconditioning: packages.preconditioning_sessions > 0 (contract_date 축)
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(p){const o={};try{for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}catch{}return o;}
const env={...loadEnv(".env.local"),...loadEnv(".env")};
const sb=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

async function pageAll(table, cols, filt){
  let out=[], from=0, size=1000;
  for(;;){
    let q=sb.from(table).select(cols).range(from,from+size-1);
    if(filt) q=filt(q);
    const {data,error}=await q;
    if(error){console.error(table,"ERR",error.message);process.exit(1);}
    out=out.concat(data); if(data.length<size) break; from+=size;
  }
  return out;
}

// 1) services id -> category
const services = await pageAll("services","id,category");
const svcCat = new Map(services.map(s=>[s.id, s.category]));

// 2) check_in_services: id, check_in_id, service_id
const cis = await pageAll("check_in_services","id,check_in_id,service_id");
const cisByCheckin = new Map(); // check_in_id -> [service_id...]
for(const r of cis){ if(!cisByCheckin.has(r.check_in_id)) cisByCheckin.set(r.check_in_id,[]); cisByCheckin.get(r.check_in_id).push(r.service_id); }

// 3) payments: valid (deleted_at IS NULL). accounting_date 축.
const pays = await pageAll("payments","id,check_in_id,accounting_date,payment_type,deleted_at,cancelled_at,amount");

const TARGET = ["처방약","상병","처방","기타","풋케어"]; // single_paid target categories
const agg = {}; // category -> {payments:Set, cis:count, latest:date}
for(const c of TARGET) agg[c]={pay:new Set(), cisIds:new Set(), latest:null, amt:0};

// map each payment to categories via its check_in's services
for(const p of pays){
  if(p.deleted_at) continue; // 잡힌거=유효 결제만
  const svcIds = cisByCheckin.get(p.check_in_id)||[];
  const seen=new Set();
  for(const sid of svcIds){
    const cat = svcCat.get(sid) || "other";
    if(!TARGET.includes(cat)) continue;
    if(!seen.has(cat)){
      agg[cat].pay.add(p.id);
      const d = p.accounting_date;
      if(d && (!agg[cat].latest || d>agg[cat].latest)) agg[cat].latest=d;
      const signed = p.payment_type==='refund' ? -(p.amount||0) : (p.amount||0);
      agg[cat].amt += signed;
      seen.add(cat);
    }
  }
}

// 4) preconditioning via packages
const pkgs = await pageAll("packages","id,preconditioning_sessions,contract_date,status");
let pcCount=0, pcLatest=null, pcExcluded=0;
for(const pk of pkgs){ if((pk.preconditioning_sessions||0)>0){ if(pk.status==='cancelled'){pcExcluded++;continue;} pcCount++; const d=pk.contract_date; if(d && (!pcLatest||d>pcLatest)) pcLatest=d; } }

console.log("=== 비-PHI 집계 (실명 0) — 유효 결제/패키지 기준 ===");
const LABEL={"처방약":"처방약","상병":"상병","처방":"처방","기타":"기타","풋케어":"풋케어(단건)"};
for(const c of TARGET){
  console.log(`${LABEL[c].padEnd(12)} | 결제건수(distinct payments): ${String(agg[c].pay.size).padStart(4)} | 최근 결제일: ${agg[c].latest||"-"} | 합계금액: ${agg[c].amt.toLocaleString()}`);
}
console.log(`${"프리컨디셔닝".padEnd(12)} | 패키지건수(preconditioning_sessions>0): ${String(pcCount).padStart(4)} | 최근 계약일: ${pcLatest||"-"} (취소제외 ${pcExcluded})`);
console.log("\n(참고) payments 유효행 총:", pays.filter(p=>!p.deleted_at).length, "/ services:", services.length, "/ check_in_services:", cis.length);

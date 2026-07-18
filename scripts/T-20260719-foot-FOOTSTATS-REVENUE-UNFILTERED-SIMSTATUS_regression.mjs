/**
 * T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS — REGRESSION (db_only 검증 스펙)
 * e2e=db_only(면제) → 브라우저 E2E 대신 DB 불변식 회귀 검증(READ-ONLY, 재실행 가능).
 * 불변식:
 *   R1. foot_stats_revenue 정의에 status/sim 필터 술어 2종 실재 (prod live)
 *   R2. RPC single_amount == 진성-only 직접합계 (무필터 상위합과 divergence = 시뮬·취소 제외분)
 *   R3. 시뮬/삭제 결제행이 RPC 반환에 미포함 (0 leak)
 * DB: rxlomoozakkjesdqjtvd. author: dev-foot / 2026-07-19.
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
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const C='74967aea-a60b-4da3-a0e7-9c997a930bc8', F='2026-01-01', T='2026-12-31';
let pass=true; const log=(n,ok,d='')=>{pass=pass&&ok;console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  '+d:''}`);};

// R1
const def=(await q(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`))[0].def;
log('R1 status+sim 필터 술어 실재', /status NOT IN \('cancelled', 'deleted'\)/.test(def) && /is_simulation IS TRUE/.test(def));

// R2 RPC vs 진성-only 직접합
const rpc=(await q(`SELECT COALESCE(SUM(single_amount),0)::bigint s FROM foot_stats_revenue('${C}'::uuid,'${F}'::date,'${T}'::date);`))[0].s;
const direct=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0)::bigint s FROM payments pm WHERE clinic_id='${C}' AND accounting_date BETWEEN '${F}' AND '${T}' AND status NOT IN ('cancelled','deleted') AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=pm.customer_id AND c.is_simulation IS TRUE);`))[0].s;
log('R2 RPC single == 진성-only 직접합', String(rpc)===String(direct), `rpc=${rpc} direct=${direct}`);

// R3 시뮬/삭제 leak 0 (무필터합 - 진성합 = 제외분 >= 0, 그리고 제외분이 시뮬/삭제행합과 일치)
const unf=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0)::bigint s FROM payments WHERE clinic_id='${C}' AND accounting_date BETWEEN '${F}' AND '${T}';`))[0].s;
const excl=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0)::bigint s FROM payments pm WHERE clinic_id='${C}' AND accounting_date BETWEEN '${F}' AND '${T}' AND (status IN ('cancelled','deleted') OR EXISTS(SELECT 1 FROM customers c WHERE c.id=pm.customer_id AND c.is_simulation IS TRUE));`))[0].s;
log('R3 무필터 == 진성 + 제외분 (leak 0 회복)', BigInt(unf)===BigInt(rpc)+BigInt(excl), `unfiltered=${unf} filtered=${rpc} excluded=${excl}`);

console.log(pass?'\n✅ REGRESSION PASS (db_only)':'\n❌ REGRESSION FAIL');
process.exit(pass?0:1);

/**
 * T-20260710-foot-RESVROUTE-VISITCHANNEL-UNIFY — PROD 증거기반 probe (READ-ONLY)
 * FIX-REQUEST MSG-20260710-115929-fsc9 (supervisor): git merge != prod DB. commit e0636a47 데이터-FE 정합 실증.
 * 검증: (1) customers/reservations visit_route CHECK 6값(TM/워크인/인바운드/지인소개/네이버/인콜) 실재
 *       (2) customers.referral_name(text,nullable) 실재  (3) prod 실데이터 visit_route 전량이 FE 허용집합 내(orphan 0)
 * 결과(2026-07-10): 3항목 전부 PASS → 신규 마이그 0(선행 20260518000010/20260624100000 이미 prod 적용). db_change=false 정본.
 * author: dev-foot / 2026-07-10
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out={};
// 1) CHECK constraint defs
out.checks = await q(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname IN ('customers_visit_route_check','reservations_visit_route_check');`);
// 2) referral_name column
out.referral_col = await q(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND column_name='referral_name' AND table_name='customers';`);
// 3) actual distinct visit_route values in prod data
out.cust_routes = await q(`SELECT visit_route, count(*) n FROM customers GROUP BY visit_route ORDER BY n DESC;`);
out.resv_routes = await q(`SELECT visit_route, count(*) n FROM reservations GROUP BY visit_route ORDER BY n DESC;`);
console.log(JSON.stringify(out,null,2));

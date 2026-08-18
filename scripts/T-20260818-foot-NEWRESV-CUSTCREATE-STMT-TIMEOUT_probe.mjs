/**
 * T-20260818-foot-NEWRESV-CUSTCREATE-STMT-TIMEOUT — PROD 진단 probe (READ-ONLY, 무변경)
 * 목적: create-path 57014 statement_timeout RC 재확인.
 *   (1) customers 규모/인덱스 — INSERT 경로가 인덱스부재 병목인지
 *   (2) pg_stat_statements top DB 소비자 — storage.search 포화 지속 여부
 *   (3) 라이브 active 쿼리 — 현재 compute 포화/장기쿼리 상태
 * author: dev-foot / 2026-08-18
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
// 1) customers 규모 + 인덱스 (INSERT 병목이 인덱스부재인지)
out.cust_size = await q(`SELECT reltuples::bigint est_rows, pg_size_pretty(pg_total_relation_size('public.customers')) total_size FROM pg_class WHERE oid='public.customers'::regclass;`);
out.cust_indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='customers' ORDER BY indexname;`);
// 2) top DB 소비자 (storage.search 포화 지속?)
out.top_consumers = await q(`SELECT left(query,60) q, calls, round(total_exec_time/1000)::bigint total_exec_s, round(mean_exec_time::numeric,1) mean_ms FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 6;`);
// 3) 라이브 active 쿼리 (현재 포화/장기쿼리)
out.active_now = await q(`SELECT round(extract(epoch from (now()-query_start))::numeric,1) dur_s, state, wait_event_type, left(query,50) q FROM pg_stat_activity WHERE state='active' AND pid<>pg_backend_pid() ORDER BY query_start LIMIT 12;`);
// 4) 락 대기 여부
out.lock_waits = await q(`SELECT count(*) n FROM pg_stat_activity WHERE wait_event_type='Lock';`);
console.log(JSON.stringify(out,null,2));

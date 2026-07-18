/**
 * T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS — APPLY (prod)
 * DB: rxlomoozakkjesdqjtvd (obliv-foot-crm). author: dev-foot / 2026-07-19.
 * DRYRUN_PASS 선행(무영속 검증 완료). CREATE OR REPLACE 시그니처 불변 → 즉시 역전 가능.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t;
}
const sql = readFileSync('supabase/migrations/20260719140000_foot_stats_revenue_filter_sim_status.sql','utf8');
await q(sql);
console.log('APPLIED.');

// C10 post-apply: 새 정의 실재 확인 (필터 술어 2종 존재)
const post = JSON.parse(await q(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`));
const def = post[0].def;
console.log('has_status_filter :', /status NOT IN \('cancelled', 'deleted'\)/.test(def));
console.log('has_sim_filter    :', /is_simulation IS TRUE/.test(def));

// 함수 호출 델타 재확인 (적용 후 실제 RPC 반환값 합계)
const agg = JSON.parse(await q(`
SELECT COALESCE(SUM(single_amount),0) single_sum, COALESCE(SUM(package_amount),0) pkg_sum, COALESCE(SUM(refund_amount),0) refund_sum
FROM foot_stats_revenue('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid, '2026-01-01'::date, '2026-12-31'::date);`));
console.log('post-apply RPC agg (clinic 74967aea, 2026):', JSON.stringify(agg[0]));

// ledger 등재 (supabase_migrations.schema_migrations)
await q(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260719140000', 'foot_stats_revenue_filter_sim_status') ON CONFLICT (version) DO NOTHING;`);
const led = JSON.parse(await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260719140000';`));
console.log('ledger_registered :', led.length===1, JSON.stringify(led));

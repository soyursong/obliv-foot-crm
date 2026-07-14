/**
 * T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY — 마이그 DRY-RUN (Management API, 무영속)
 * Migration Dry-Run No-Persistence Protocol 준수:
 *   (0) baseline : 두 함수 prosrc md5 캡처
 *   (1) canary   : BEGIN; COMMENT __CANARY__; ROLLBACK; → 엔드포인트 ROLLBACK 실효 선증명(잔존시 ABORT)
 *   (2) apply    : BEGIN; <txn-control strip 한 up.sql>; <신 정의로 함수 호출 캡처>; ROLLBACK;
 *   (3) equiv    : 신 정의(in-txn) 출력 == 현행 live(created_at) 출력  → 현데이터 no-op 실증(T1)
 *   (4) post-probe: prosrc md5 재캡처 == baseline (무영속 확증, sentinel-bypass 차단)
 * READ/무영속. 실 데이터 무변경. author: dev-foot / 2026-07-15
 * 실행: node scripts/T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY_dryrun_mgmtapi.mjs
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const REF='rxlomoozakkjesdqjtvd';
const CANARY='__DRYRUN_CANARY_T20260715_AXIS__';
if(!TOKEN){console.error('no token');process.exit(1);}
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const md5s=async()=>q(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) m FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('foot_stats_revenue','foot_stats_by_category') ORDER BY 1;`);

// migration up.sql, txn-control(BEGIN;/COMMIT;) strip
let up = readFileSync('supabase/migrations/20260715140000_foot_stats_revenue_attrib_axis_unify.sql','utf8');
up = up.replace(/^\s*BEGIN\s*;\s*$/gmi,'').replace(/^\s*COMMIT\s*;\s*$/gmi,'');

const results={};
try{
  // (0) baseline
  const base = await md5s(); results.baseline_md5 = base;

  // (1) canary
  await q(`BEGIN; COMMENT ON FUNCTION public.foot_stats_revenue(uuid,date,date) IS '${CANARY}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.foot_stats_revenue(uuid,date,date)'::regprocedure) d;`);
  if((c[0]?.d||'').includes(CANARY)){ throw new Error('CANARY PERSISTED — endpoint ROLLBACK 무효, ABORT (실 DDL 미실행)'); }
  results.canary='ROLLBACK 실효 확인(잔존 0)';

  // clinics present in payments
  const clinics = await q(`SELECT DISTINCT clinic_id FROM payments UNION SELECT DISTINCT clinic_id FROM package_payments;`);
  results.clinics = clinics.map(x=>x.clinic_id);
  const win = `'2026-01-01'::date, '2026-12-31'::date`;

  // (3-live) 현행 live 출력 (created_at 축)
  const liveOut = {};
  for(const cid of results.clinics){
    liveOut[cid] = {
      rev: await q(`SELECT * FROM public.foot_stats_revenue('${cid}', ${win}) ORDER BY dt;`),
      cat: await q(`SELECT * FROM public.foot_stats_by_category('${cid}', ${win}) ORDER BY category;`),
    };
  }

  // (2) apply new defs in-txn + capture output, then ROLLBACK — single query
  const cid0 = results.clinics[0];
  const applyOut = {};
  for(const cid of results.clinics){
    const sql = `BEGIN;\n${up}\nSELECT json_build_object(
        'rev',(SELECT coalesce(json_agg(t),'[]') FROM (SELECT * FROM public.foot_stats_revenue('${cid}', ${win}) ORDER BY dt) t),
        'cat',(SELECT coalesce(json_agg(u),'[]') FROM (SELECT * FROM public.foot_stats_by_category('${cid}', ${win}) ORDER BY category) u)
      ) AS out;\nROLLBACK;`;
    const rows = await q(sql);
    // multi-statement: endpoint returns last SELECT rows
    applyOut[cid] = rows[0].out;
  }
  results.apply='적용 무오류(BEGIN..ROLLBACK)';

  // (3-equiv) compare live(created_at) vs new(accounting_date)
  const norm=(a)=>JSON.stringify(a);
  let equiv=true; const diffs=[];
  for(const cid of results.clinics){
    if(norm(liveOut[cid].rev)!==norm(applyOut[cid].rev)){ equiv=false; diffs.push({cid,fn:'revenue',live:liveOut[cid].rev,new:applyOut[cid].rev}); }
    if(norm(liveOut[cid].cat)!==norm(applyOut[cid].cat)){ equiv=false; diffs.push({cid,fn:'by_category',live:liveOut[cid].cat,new:applyOut[cid].cat}); }
  }
  results.equivalence = equiv ? 'PASS — 신/구 축 출력 비트동일(현데이터 no-op, T1 정합)' : 'DIFF 발견';
  if(!equiv) results.diffs=diffs;

  // (4) post-probe
  const post = await md5s(); results.postprobe_md5 = post;
  const persisted = JSON.stringify(base)!==JSON.stringify(post);
  results.no_persistence = persisted ? 'FAIL — prosrc 변동(영속됨!)' : 'PASS — prosrc 무변동(무영속 확증)';

  results.VERDICT = (!persisted && equiv) ? 'DRYRUN PASS' : 'DRYRUN FAIL';
}catch(e){ results.ERROR=String(e); results.VERDICT='DRYRUN FAIL'; }
console.log(JSON.stringify(results,null,2));

/**
 * T-20260715-foot-BYCAT-IVEXCLUDE-PROD-RECONCILE — 마이그 DRY-RUN (Management API, 무영속)
 * Migration Dry-Run No-Persistence Protocol 준수:
 *   (0) baseline  : foot_stats_by_category prosrc md5 캡처
 *   (1) canary    : BEGIN; COMMENT __CANARY__; ROLLBACK; → 엔드포인트 ROLLBACK 실효 선증명(잔존시 ABORT)
 *   (2) apply     : BEGIN; <txn-control strip 한 up.sql>; <신 정의 prosrc+출력 캡처>; ROLLBACK;
 *   (3) invariant : 신 정의 prosrc 에 axis(accounting_date + session_date) AND iv-exclude(session_type<>'iv') 둘 다 present
 *   (4) delta     : 신/구 출력 비교 — 차이는 오직 iv category 행 제거만 허용(현데이터 iv used=0 → 무변동 no-op)
 *   (5) post-probe: prosrc md5 재캡처 == baseline (무영속 확증, sentinel-bypass 차단)
 *   (6) ledger    : 3자 대조 — 파일(150000 신규 미등재) / prod live(post-AXIS,iv부재) / ledger(140000 present,150000·20260706120000 absent)
 * READ/무영속. 실 데이터 무변경. author: dev-foot / 2026-07-15
 * 실행: node scripts/T-20260715-foot-BYCAT-IVEXCLUDE-PROD-RECONCILE_dryrun_mgmtapi.mjs
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const REF='rxlomoozakkjesdqjtvd';
const CANARY='__DRYRUN_CANARY_T20260715_BYCAT_IVEX__';
if(!TOKEN){console.error('no token');process.exit(1);}
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const md5=async()=>q(`SELECT md5(pg_get_functiondef(p.oid)) m FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_by_category';`);

// migration up.sql, txn-control(BEGIN;/COMMIT;) strip
let up = readFileSync('supabase/migrations/20260715150000_foot_stats_by_category_iv_exclude_rebase_post_axis.sql','utf8');
up = up.replace(/^\s*BEGIN\s*;\s*$/gmi,'').replace(/^\s*COMMIT\s*;\s*$/gmi,'');

const results={};
try{
  // (0) baseline
  results.baseline_md5 = (await md5())[0].m;

  // (1) canary — ROLLBACK 실효 선증명
  await q(`BEGIN; COMMENT ON FUNCTION public.foot_stats_by_category(uuid,date,date) IS '${CANARY}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.foot_stats_by_category(uuid,date,date)'::regprocedure) d;`);
  if((c[0]?.d||'').includes(CANARY)){ throw new Error('CANARY PERSISTED — endpoint ROLLBACK 무효, ABORT (실 DDL 미실행)'); }
  results.canary='ROLLBACK 실효 확인(잔존 0)';

  // clinics + window
  const clinics = await q(`SELECT DISTINCT clinic_id FROM payments UNION SELECT DISTINCT clinic_id FROM package_payments;`);
  results.clinics = clinics.map(x=>x.clinic_id);
  const win = `'2026-01-01'::date, '2026-12-31'::date`;

  // (3-live) 현행 live 출력 (post-AXIS, iv 미제외)
  const liveOut = {};
  for(const cid of results.clinics){
    liveOut[cid] = await q(`SELECT * FROM public.foot_stats_by_category('${cid}', ${win}) ORDER BY category;`);
  }

  // (2) apply new def in-txn → prosrc + 출력 캡처, ROLLBACK
  const applyOut = {};
  let newProsrc=null;
  for(const cid of results.clinics){
    const sql = `BEGIN;\n${up}\nSELECT json_build_object(
        'prosrc',(SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_by_category'),
        'cat',(SELECT coalesce(json_agg(u),'[]') FROM (SELECT * FROM public.foot_stats_by_category('${cid}', ${win}) ORDER BY category) u)
      ) AS out;\nROLLBACK;`;
    const rows = await q(sql);
    applyOut[cid] = rows[0].out.cat;
    newProsrc = newProsrc || rows[0].out.prosrc;
  }
  results.apply='적용 무오류(BEGIN..ROLLBACK)';

  // (3) invariant — axis AND iv-exclude 둘 다 present
  const hasAxisAcct = /accounting_date/.test(newProsrc);
  const hasSessionDate = /session_date/.test(newProsrc);         // pkg_used 소진 사건일 보존
  const hasIvExclude = /session_type\s*<>\s*'iv'/.test(newProsrc);
  results.invariant = {
    axis_accounting_date: hasAxisAcct,
    pkg_used_session_date: hasSessionDate,
    iv_exclude_predicate: hasIvExclude,
    PASS: hasAxisAcct && hasSessionDate && hasIvExclude,
  };

  // (4) delta — 신/구 출력 차이는 iv 행 제거만 허용 (iv used=0 이면 무변동 예상)
  const norm=(a)=>JSON.stringify(a);
  let deltaOk=true; const diffRows=[];
  for(const cid of results.clinics){
    const live=liveOut[cid], nu=applyOut[cid];
    const nuMap=Object.fromEntries(nu.map(r=>[r.category,r]));
    for(const lr of live){
      const nr=nuMap[lr.category];
      if(!nr){ if(lr.category!=='iv'){ deltaOk=false; diffRows.push({cid,removed:lr}); } }
      else if(norm(nr)!==norm(lr)){ deltaOk=false; diffRows.push({cid,changed:{live:lr,new:nr}}); }
    }
  }
  results.delta = { only_iv_removed: deltaOk, diffRows, note:'현데이터 iv used=0 → 무변동(no-op) 예상; predicate 는 정책-예방적' };

  // (5) post-probe
  results.postprobe_md5 = (await md5())[0].m;
  const persisted = results.baseline_md5 !== results.postprobe_md5;
  results.no_persistence = persisted ? 'FAIL — prosrc 변동(영속됨!)' : 'PASS — prosrc 무변동(무영속 확증)';

  // (6) ledger 3자 대조
  const led = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20260706120000','20260715140000','20260715150000') ORDER BY version;`);
  const has=(v)=>led.some(x=>x.version===v);
  results.ledger_3way = {
    axis_140000_present: has('20260715140000'),        // AXIS 이미 착지(created_by=supervisor)
    new_150000_absent: !has('20260715150000'),         // 본 마이그 미배포(배포시 등재)
    dead_20260706120000_absent: !has('20260706120000'),// 죽은 timestamp 미등재(부활 금지)
  };

  results.VERDICT = (!persisted && results.invariant.PASS && deltaOk) ? 'DRYRUN PASS' : 'DRYRUN FAIL';
}catch(e){ results.ERROR=String(e); results.VERDICT='DRYRUN FAIL'; }
console.log(JSON.stringify(results,null,2));

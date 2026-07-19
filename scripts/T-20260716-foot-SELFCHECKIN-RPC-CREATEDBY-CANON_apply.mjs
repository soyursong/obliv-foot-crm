/**
 * T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — PROD apply (supervisor 게이트 후)
 * ADDITIVE 함수 DDL(2 함수 INSERT-only created_by 스탬프). 절차:
 *   (1) pre 스탬프 부재 확인 → (2) dry-run(BEGIN;apply;introspect;ROLLBACK, no-persist)
 *   → (3) --apply 시 실적용(원자 BEGIN;COMMIT) → (4) post 스탬프 실재 + DDL-ATOMIC applied_at evidence.
 * 롤백: 20260719120000_..._createdby_stamp.rollback.sql (스탬프-前 prod verbatim).
 * READ-ONLY(무 --apply): dry-run 까지만.
 */
import fs from 'fs';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local'))
  for (const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);if(m)TOKEN=m[1].trim();}
if (!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 필요');process.exit(1);}
const REF='rxlomoozakkjesdqjtvd';
const DO_APPLY = process.argv.includes('--apply');
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`${r.status} ${t.slice(0,400)}`);return t.trim()?JSON.parse(t):[];}

const MIG='supabase/migrations/20260719120000_selfcheckin_v3_reservlink_createdby_stamp.sql';
const FNS=['fn_selfcheckin_upsert_customer_resolve_v3','self_checkin_with_reservation_link'];
const stampSql=(fn)=>`SELECT (pg_get_functiondef(p.oid) ~* 'INSERT INTO customers\\s*\\([^)]*created_by') AS ins_stamped FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}';`;

(async()=>{
  const mig=fs.readFileSync(MIG,'utf8');
  console.log('── PRE ──');
  for(const fn of FNS){const r=await q(stampSql(fn));console.log(`  ${fn}: INSERT created_by = ${r[0].ins_stamped?'PRESENT':'ABSENT'}`);}

  // dry-run (no-persist): strip outer txn-control, wrap BEGIN…ROLLBACK
  const ddl=mig.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  await q(`BEGIN;\n${ddl}\nROLLBACK;`);
  console.log('── DRY-RUN: BEGIN…ROLLBACK OK (no-persist) ──');
  for(const fn of FNS){const r=await q(stampSql(fn));if(r[0].ins_stamped)throw new Error('post-probe: dry-run persisted! abort');}
  console.log('  post-probe: 무영속 확인 ✓');

  if(!DO_APPLY){console.log('\n(무 --apply: dry-run 까지만. 실적용은 --apply)');return;}

  // apply (atomic)
  await q(mig);
  console.log('── APPLIED (atomic BEGIN;COMMIT) ──');
  const ev={ticket:'T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON',project:REF,migration:MIG,funcs:{}};
  const at=await q(`SELECT now() AT TIME ZONE 'Asia/Seoul' AS applied_at_kst;`);
  ev.applied_at_kst=at[0].applied_at_kst;
  let ok=true;
  for(const fn of FNS){const r=await q(stampSql(fn));ev.funcs[fn]=r[0].ins_stamped;if(!r[0].ins_stamped)ok=false;console.log(`  ${fn}: INSERT created_by = ${r[0].ins_stamped?'PRESENT ✓':'ABSENT ✗'}`);}
  ev.verdict=ok?'STAMP_LIVE':'FAIL';
  fs.writeFileSync('db-gate/T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON_applied_evidence.json',JSON.stringify(ev,null,2));
  console.log('\nDDL-ATOMIC applied_at evidence → db-gate/...applied_evidence.json');
  console.log(JSON.stringify(ev,null,2));
  if(!ok)process.exit(1);
})().catch(e=>{console.error('❌ '+e.message);process.exit(1);});

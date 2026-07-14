/**
 * T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE — 무영속 dry-run (Migration Dry-Run No-Persistence Protocol)
 *   · up.sql 의 txn-control(BEGIN;/COMMIT;) strip → 본 러너가 BEGIN…ROLLBACK 로 감싸 무영속 보장.
 *   · in-tx: 두 함수 가드 present 확인 + 5개 행위테스트(가드 fire / 회귀 무 / carve-out 무해).
 *   · post-tx introspection(별도 쿼리): prod 에 가드 미영속 확증(has_guard=false = 아직 supervisor 미apply).
 * 실제 prod apply 는 supervisor DDL-diff 게이트 소관. author: dev-foot / 2026-07-15.
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let T=process.env.SUPABASE_ACCESS_TOKEN; if(!T){try{T=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
if(!T){console.error('❌ SUPABASE_ACCESS_TOKEN 필요');process.exit(1);}
const q=async s=>{const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},body:JSON.stringify({query:s})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);};
const rows=x=>x.result??x;

// up.sql 의 top-level txn-control 만 strip (plpgsql 내부 BEGIN 은 세미콜론 없음 → 미매치)
const up = readFileSync('supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.sql','utf8')
  .split('\n').filter(l => !/^BEGIN;\s*$/.test(l) && !/^COMMIT;\s*$/.test(l)).join('\n');

const SLUG='jongno-foot';
const tests = `
CREATE TEMP TABLE _dr(t text, result text) ON COMMIT DROP;

-- A: reissue 마스킹 입력 → 가드 fire (기대 22023)
DO $D$ BEGIN
  PERFORM public.fn_dashboard_reissue_health_q_token('7887','${SLUG}','접****1');
  INSERT INTO _dr VALUES('A_reissue_masked','NO_REJECT❌');
EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('A_reissue_masked','rejected '||SQLSTATE); END $D$;

-- B: reissue 정상 성함 + 없는 clinic → 가드 통과, clinic_not_found JSON (회귀 무·false-reject 무)
DO $D$ DECLARE j jsonb; BEGIN
  j := public.fn_dashboard_reissue_health_q_token('+821099998888','__dryrun_no_clinic__','홍길동');
  INSERT INTO _dr VALUES('B_reissue_legit','passed guard → '||COALESCE(j->>'error','ok'));
EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('B_reissue_legit','UNEXPECTED '||SQLSTATE); END $D$;

-- C: upsert 마스킹 active 푸시 (real slug) → customers persist 경계 가드 fire (기대 22023)
DO $D$ BEGIN
  PERFORM public.upsert_reservation_from_source('dopamine','__dr_c__','${SLUG}','7887','접****1',CURRENT_DATE+1,'10:00');
  INSERT INTO _dr VALUES('C_upsert_masked_active','NO_REJECT❌');
EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('C_upsert_masked_active','rejected '||SQLSTATE); END $D$;

-- D: upsert 마스킹 + 취소 fast-path (없는 external_id) → 가드 미도달, NULL 반환 (carve-out: 취소 hard-fail 무)
DO $D$ DECLARE u uuid; BEGIN
  u := public.upsert_reservation_from_source('dopamine','__dr_d_absent__','${SLUG}','7887','접****1',CURRENT_DATE+1,'10:00','도파민','cancelled');
  INSERT INTO _dr VALUES('D_upsert_masked_cancel','no-reject, returned '||COALESCE(u::text,'NULL'));
EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('D_upsert_masked_cancel','UNEXPECTED '||SQLSTATE); END $D$;

-- E: upsert 정상 성함 active (real slug) → 가드 통과, 예약 upsert 성공 uuid (회귀 무·false-reject 무)
DO $D$ DECLARE u uuid; BEGIN
  u := public.upsert_reservation_from_source('dopamine','__dr_e__','${SLUG}','+821077776666','김정상',CURRENT_DATE+1,'11:00');
  INSERT INTO _dr VALUES('E_upsert_legit_active','passed guard → '||CASE WHEN u IS NOT NULL THEN 'reservation ok' ELSE 'NULL' END);
EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('E_upsert_legit_active','UNEXPECTED '||SQLSTATE); END $D$;

-- in-tx 가드 present 확인 + 결과 취합 (마지막 SELECT = 반환셋)
INSERT INTO _dr
  SELECT 'GUARD_PRESENT:'||p.proname, (pg_get_functiondef(p.oid) ILIKE '%_fn_is_masked_pii%')::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('fn_dashboard_reissue_health_q_token','upsert_reservation_from_source');
SELECT t, result FROM _dr ORDER BY t;
`;

async function main(){
  console.log('=== DRY-RUN (무영속: BEGIN…ROLLBACK) ===\n');
  const r = rows(await q(`BEGIN;\n${up}\n${tests}\nROLLBACK;`));
  console.log('in-tx 결과:');
  (Array.isArray(r)?r:[]).forEach(x=>console.log(`  [${x.t}] ${x.result}`));

  console.log('\n=== POST-TX 무영속 확증 (prod 실재 — supervisor apply 前 has_guard=false 기대) ===');
  const post = rows(await q(`SELECT p.proname, (pg_get_functiondef(p.oid) ILIKE '%_fn_is_masked_pii%') AS has_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fn_dashboard_reissue_health_q_token','upsert_reservation_from_source') ORDER BY p.proname;`));
  post.forEach(x=>console.log(`  ${x.proname} has_guard=${x.has_guard}  ${x.has_guard?'⚠(이미 apply됨)':'✅(미영속=dry-run 무영속 확증)'}`));

  // 판정
  const map = Object.fromEntries((Array.isArray(r)?r:[]).map(x=>[x.t,x.result]));
  const pass =
    /rejected 22023/.test(map.A_reissue_masked||'') &&
    /passed guard/.test(map.B_reissue_legit||'') &&
    /rejected 22023/.test(map.C_upsert_masked_active||'') &&
    /no-reject/.test(map.D_upsert_masked_cancel||'') &&
    /passed guard/.test(map.E_upsert_legit_active||'') &&
    (map['GUARD_PRESENT:fn_dashboard_reissue_health_q_token']==='true') &&
    (map['GUARD_PRESENT:upsert_reservation_from_source']==='true') &&
    post.every(x=>x.has_guard===false);
  console.log(`\n=== 판정: ${pass?'PASS ✅ (가드 fire + 회귀 무 + carve-out 무해 + 무영속)':'FAIL ⚠ — 위 결과 확인'} ===`);
  if(!pass) process.exit(2);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});

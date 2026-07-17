/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #6 정혜인 — APPLY (atomic single-txn DO block)
 * supervisor DB-GATE-GO MSG-20260718-012030-291v. per-person BEGIN..COMMIT 등가(atomic DO block).
 * soft-delete only (의료법 §22, hard-DELETE 금지). 모든 가드 내부 RAISE EXCEPTION → 실패 시 전체 자동 ROLLBACK.
 * 선행: _6_fresh_snapshot.mjs 가드 전부 PASS 확인 완료(no drift).
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 없음');process.exit(1);}
const DUP='5f141f76-7f72-4560-8a67-bbcdf4938cad';
const CANON='c851fbb1-31ce-4714-b91c-03e9cb8af566';
const CANON_USER='3bd596ca-036b-423c-a4f6-3cbab8083133'; // fresh snapshot 확정치

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const txt=await r.text();
  return {status:r.status, txt};
}

// 원자 DO block — 가드 하나라도 어긋나면 RAISE → 전체 롤백, API가 에러 반환.
const applySQL=`
DO $$
DECLARE
  v_dup uuid := '${DUP}';
  v_canon uuid := '${CANON}';
  v_canon_user_before uuid := '${CANON_USER}';
  v_ra int; v_remaining int; v_soft int;
  v_canon_active boolean; v_canon_user uuid;
BEGIN
  -- [가드0a] DUP 정확히 1행 active=false
  IF (SELECT count(*) FROM staff WHERE id=v_dup AND active=false) <> 1 THEN
    RAISE EXCEPTION 'GUARD0a: DUP not exactly 1 inactive row'; END IF;
  -- [가드0b] CANON 정확히 1행 active=true
  IF (SELECT count(*) FROM staff WHERE id=v_canon AND active=true) <> 1 THEN
    RAISE EXCEPTION 'GUARD0b: CANON not exactly 1 active row'; END IF;
  -- [재귀속] room_assignments 2건 → CANON
  UPDATE room_assignments SET staff_id=v_canon WHERE staff_id=v_dup;
  GET DIAGNOSTICS v_ra = ROW_COUNT;
  IF v_ra <> 2 THEN RAISE EXCEPTION 'REATTR: room_assignments reassigned=% (expected 2)', v_ra; END IF;
  -- [가드1] 잔여 inbound 참조 0 (4 FK 컬럼)
  SELECT (SELECT count(*) FROM duty_roster WHERE doctor_id=v_dup)
        +(SELECT count(*) FROM package_sessions WHERE performed_by=v_dup)
        +(SELECT count(*) FROM room_assignments WHERE staff_id=v_dup)
        +(SELECT count(*) FROM customers WHERE assigned_staff_id=v_dup)
    INTO v_remaining;
  IF v_remaining <> 0 THEN RAISE EXCEPTION 'GUARD1: remaining inbound refs=% (expected 0)', v_remaining; END IF;
  -- [폐기] soft-delete only (hard-DELETE 금지)
  UPDATE staff SET active=false, name = name || ' [중복정리 2026-07-18]'
   WHERE id=v_dup AND active IS NOT TRUE;
  GET DIAGNOSTICS v_soft = ROW_COUNT;
  IF v_soft <> 1 THEN RAISE EXCEPTION 'SOFTDEL: rows=% (expected 1)', v_soft; END IF;
  -- [가드2] CANON 무손상 (active·user_id 유지)
  SELECT active, user_id INTO v_canon_active, v_canon_user FROM staff WHERE id=v_canon;
  IF v_canon_active IS NOT TRUE OR v_canon_user IS DISTINCT FROM v_canon_user_before THEN
    RAISE EXCEPTION 'GUARD2: CANON altered active=% user_id=%', v_canon_active, v_canon_user; END IF;
  RAISE NOTICE 'APPLY OK reattr=% soft=% remaining=%', v_ra, v_soft, v_remaining;
END $$;`;

console.log('▶ APPLY (atomic DO block) 실행…');
const res=await sql(applySQL);
console.log('HTTP', res.status);
console.log(res.txt);
if(res.status>=300){
  console.error('\n🔴 APPLY 실패 — DO block 예외 → 전체 자동 ROLLBACK. prod 무변경.');
  fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_6_apply.out.json',JSON.stringify({status:res.status,error:res.txt,rolled_back:true},null,2));
  process.exit(2);
}
console.log('\n✅ APPLY COMMIT 성공 (원자 DO block 완주).');
fs.writeFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_6_apply.out.json',JSON.stringify({status:res.status,result:res.txt,reattr:2,soft_delete:1,committed_at:new Date().toISOString()},null,2));

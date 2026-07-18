/**
 * T-20260701-foot-STAFF-ROSTER-DEDUP #1 박소예 — APPLY (atomic single-txn DO block)
 * supervisor DB-GATE-GO(조건부) MSG-20260718-130404-15h7 + DA yij8. per-person BEGIN..COMMIT 등가(atomic DO block).
 * 선행: _1_fresh_snapshot 게이트 가드 전부 PASS + freeze 매니페스트 확정(no drift/collision).
 *
 * txn 순서(활성-count 0 window 무진입):
 *   ①4컬럼 재귀속(→CANON, 컬럼별 freeze 대사) → ②DUP inbound 4컬럼 0 가드 →
 *   ③CANON active=true 동반 활성화 → ④DUP soft-delete(가드 active IS TRUE) → ⑤활성-count 불변식(정확히1=CANON)
 * soft-delete only (의료법 §22, hard-DELETE 금지). 가드 하나라도 어긋나면 RAISE → 전체 자동 ROLLBACK.
 */
import fs from 'fs';
function env(k){for(const f of ['.env.local','.env']){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(new RegExp('^'+k+'=(.*)$'));if(m)return m[1].trim().replace(/^"|"$/g,'');}}return process.env[k]||null;}
const TOKEN=env('SUPABASE_ACCESS_TOKEN'), REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 없음');process.exit(1);}

// ── 선행: freeze 매니페스트 로드 & 게이트 확인 ──
const snapPath='scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_fresh_snapshot.out.json';
if(!fs.existsSync(snapPath)){console.error('❌ fresh snapshot 없음 — 먼저 _1_fresh_snapshot.mjs 실행');process.exit(1);}
const {manifest}=JSON.parse(fs.readFileSync(snapPath,'utf8'));
if(!manifest.all_guards_pass){console.error('🔴 freeze 매니페스트 all_guards_pass=false — apply 금지');process.exit(2);}
const F=manifest.per_column_freeze; // {duty_roster,package_sessions,room_assignments,customers}
const DUP=manifest.dup, CANON=manifest.canon, CANON_USER=manifest.canon_user;
console.log('freeze 매니페스트:', JSON.stringify(F), 'clinic', manifest.clinic_id);

async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const txt=await r.text();
  return {status:r.status, txt};
}

const applySQL=`
DO $$
DECLARE
  v_dup uuid := '${DUP}';
  v_canon uuid := '${CANON}';
  v_canon_user uuid := '${CANON_USER}';
  v_duty int; v_pkg int; v_room int; v_cust int;
  v_remaining int; v_act int; v_soft int; v_active_count int;
  v_canon_active boolean; v_canon_user_after uuid;
BEGIN
  -- [가드0a] DUP 정확히 1행 active=TRUE user_id=null (폐기대상=활성행, #6과 反轉)
  IF (SELECT count(*) FROM staff WHERE id=v_dup AND active=true AND user_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'GUARD0a: DUP not exactly 1 active/null-user row'; END IF;
  -- [가드0b] CANON 정확히 1행 active=false user_id=canon_user
  IF (SELECT count(*) FROM staff WHERE id=v_canon AND active=false AND user_id=v_canon_user) <> 1 THEN
    RAISE EXCEPTION 'GUARD0b: CANON not exactly 1 inactive/canon-user row'; END IF;
  -- [가드0c] clinic parity (RLS/PHI 표면 경계)
  IF (SELECT clinic_id FROM staff WHERE id=v_dup) IS DISTINCT FROM (SELECT clinic_id FROM staff WHERE id=v_canon) THEN
    RAISE EXCEPTION 'GUARD0c: clinic_id parity broken'; END IF;

  -- ① 4컬럼 재귀속 (→CANON) · 컬럼별 freeze 대사 (per-column freeze guard b)
  UPDATE duty_roster      SET doctor_id=v_canon    WHERE doctor_id=v_dup;
  GET DIAGNOSTICS v_duty = ROW_COUNT;
  IF v_duty <> ${F.duty_roster} THEN RAISE EXCEPTION 'REATTR duty_roster=% (freeze ${F.duty_roster})', v_duty; END IF;

  UPDATE package_sessions SET performed_by=v_canon WHERE performed_by=v_dup;
  GET DIAGNOSTICS v_pkg = ROW_COUNT;
  IF v_pkg <> ${F.package_sessions} THEN RAISE EXCEPTION 'REATTR package_sessions=% (freeze ${F.package_sessions})', v_pkg; END IF;

  UPDATE room_assignments SET staff_id=v_canon     WHERE staff_id=v_dup;
  GET DIAGNOSTICS v_room = ROW_COUNT;
  IF v_room <> ${F.room_assignments} THEN RAISE EXCEPTION 'REATTR room_assignments=% (freeze ${F.room_assignments})', v_room; END IF;

  UPDATE customers        SET assigned_staff_id=v_canon WHERE assigned_staff_id=v_dup;  -- PHI 귀속
  GET DIAGNOSTICS v_cust = ROW_COUNT;
  IF v_cust <> ${F.customers} THEN RAISE EXCEPTION 'REATTR customers=% (freeze ${F.customers})', v_cust; END IF;

  -- ② DUP inbound 4컬럼 전부 0 재조회 가드 (≠0 → ROLLBACK)
  SELECT (SELECT count(*) FROM duty_roster WHERE doctor_id=v_dup)
        +(SELECT count(*) FROM package_sessions WHERE performed_by=v_dup)
        +(SELECT count(*) FROM room_assignments WHERE staff_id=v_dup)
        +(SELECT count(*) FROM customers WHERE assigned_staff_id=v_dup)
    INTO v_remaining;
  IF v_remaining <> 0 THEN RAISE EXCEPTION 'GUARD1: DUP remaining inbound=% (expected 0)', v_remaining; END IF;

  -- ③ CANON active=true 동반 활성화 (같은 txn — 활성행 0개 window 무진입)
  UPDATE staff SET active=true WHERE id=v_canon AND active=false;
  GET DIAGNOSTICS v_act = ROW_COUNT;
  IF v_act <> 1 THEN RAISE EXCEPTION 'ACTIVATE CANON rows=% (expected 1)', v_act; END IF;

  -- ④ DUP soft-delete (가드 active IS TRUE, hard-DELETE 금지 의료법§22, 중복정리 마킹)
  UPDATE staff SET active=false, name = name || ' [중복정리 2026-07-18]'
   WHERE id=v_dup AND active IS TRUE;
  GET DIAGNOSTICS v_soft = ROW_COUNT;
  IF v_soft <> 1 THEN RAISE EXCEPTION 'SOFTDEL DUP rows=% (expected 1)', v_soft; END IF;

  -- [가드2] CANON 무손상: active=true AND user_id 유지(up.active=true 링크)
  SELECT active, user_id INTO v_canon_active, v_canon_user_after FROM staff WHERE id=v_canon;
  IF v_canon_active IS NOT TRUE OR v_canon_user_after IS DISTINCT FROM v_canon_user THEN
    RAISE EXCEPTION 'GUARD2: CANON altered active=% user=%', v_canon_active, v_canon_user_after; END IF;

  -- ⑤ [활성-count 불변식(조건2)] 박소예 활성행 정확히 1개 = CANON
  SELECT count(*) INTO v_active_count FROM staff WHERE name like '박소예%' AND active=true;
  IF v_active_count <> 1 THEN RAISE EXCEPTION 'GUARD3: 박소예 active rows=% (expected exactly 1)', v_active_count; END IF;
  IF (SELECT count(*) FROM staff WHERE name like '박소예%' AND active=true AND id=v_canon) <> 1 THEN
    RAISE EXCEPTION 'GUARD3b: single active 박소예 != CANON'; END IF;

  RAISE NOTICE 'APPLY OK duty=% pkg=% room=% cust=% activate=% soft=% active_count=%',
    v_duty, v_pkg, v_room, v_cust, v_act, v_soft, v_active_count;
END $$;`;

console.log('▶ APPLY (atomic DO block) 실행…');
const res=await sql(applySQL);
console.log('HTTP', res.status, res.txt);
const outPath='scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_apply.out.json';
if(res.status>=300){
  console.error('\n🔴 APPLY 실패 — DO block 예외 → 전체 자동 ROLLBACK. prod 무변경.');
  fs.writeFileSync(outPath,JSON.stringify({status:res.status,error:res.txt,rolled_back:true,freeze:F},null,2));
  process.exit(2);
}
console.log('\n✅ APPLY COMMIT 성공 (원자 DO block 완주).');
fs.writeFileSync(outPath,JSON.stringify({status:res.status,result:res.txt,reattr:F,activate:1,soft_delete:1,committed_at:new Date().toISOString()},null,2));

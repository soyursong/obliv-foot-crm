-- ════════════════════════════════════════════════════════════════════════════
-- T-20260802-foot-ST-ROOMID-FILL  (P2, foot) — [잔여 백필]
-- status_transitions.room_id 룸수반 NULL 잔차를 check_in_room_logs 에서 결정적 소급.
-- = T-20260725/T-20260730 의 60일 백필 커버범위 **밖**(older_than_60d) 잔여 + 임의 잔여.
--
-- ── AC0 leg 정합 reconcile 실측 (2026-08-02, scripts/..._ac0_reconcile.mjs) ──
--   · check_ins.room_id 컬럼 = **부재**(consultation_room/treatment_room/laser_room/
--     examination_room/room_number 뿐) → CONFLICT-DETAIL 가설A(별개 check_ins leg) 불성립.
--   · "45% NULL"(실측 62.9%, 2309/3670) = **분모 artifact** — 미수반(non-room) 전이 2251건이
--     설계상 room_id NULL(registered/*_waiting/done/cancelled/receiving)이라 전체 NULL%를 끌어올림.
--   · 룸수반(consultation/preconditioning/laser/heated_laser/examination) leg = 1419건 中
--     NULL 58건(4.1%) — 즉 "99.9%"와 동일 leg의 룸수반 분모 채움률(≈95.9%)과 정합.
--   ⇒ 두 수치는 **동일 status_transitions.room_id leg**(divergence 아님). 별개 leg 백필 아님 →
--     본 티켓 = 그 leg 의 **룸수반 NULL 잔차** 마감. superseded 아님(60일 window 밖 잔여).
--
-- ── 대상셋(실측) ──
--   룸수반 NULL 58건 中 귀속가능(±5분 check_in_room_logs 매칭 존재) = **19건** = 실 백필 대상.
--   나머지 39건 = 귀속불가(매칭 room log 부재) = 강제귀속 금지, NULL 유지·계측(자연 잔차).
--
-- 성격: ADDITIVE — 전량 NULL → fill(overwrite 아님, 파괴성 0, DDL 0). 원장 무접점(AC2).
--   룸수반 전이 한정. 미수반 전이는 대상 밖(설계상 NULL 유지).
-- 소싱: st.transitioned_at 최근접 check_in_room_logs(같은 check_in + 매칭 room_type),
--   ±5분 window 내 nearest. 매칭 없으면 freeze-set 제외 → NULL 유지(귀속불가 잔차).
-- scope: clinic 74967aea(오블리브의원 서울오리진점, foot active — 실측상 st 유일 clinic),
--   **전기간(all-time)** = 기존 60일 백필의 잔여(older_than_60d 38건 포함) 마감.
--
-- 멱등: WHERE st.room_id IS NULL (재실행 no-op / 캡처가 이미 채운 신규분 무접촉 /
--   기존 60일 백필이 채운 분 무접촉).
-- 대상셋 freeze: TEMP _bf_freeze(ON COMMIT DROP) 로 대상 id+값 확정 → 동일 셋만 UPDATE.
-- rows-affected 가드: updated == freeze count 아니면 ABORT(경합/멱등붕괴). blanket UPDATE 아님.
-- archive-first: .dryrun.mjs 가 freeze-set(st_id + would-fill) 을 evidence JSON 으로 사전 덤프.
--   rollback = 20260802170000_..._remainder.rollback.mjs (archive id-set → room_id NULL 복원).
-- cross_crm_data_correction_backfill_sop 준수. supervisor dry-run 게이트 후 apply.
-- author: dev-foot / 2026-08-02
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $backfill$
DECLARE
  v_clinic    uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브의원 서울오리진점 (foot active)
  v_freeze    int;
  v_updated   int;
  v_null_post int;
BEGIN
  -- ── freeze: 대상셋 = room_id NULL + 룸수반 to_status + 매칭 room log(±5분) 존재 ──
  --   각 대상 전이에 시간 최근접 assigned_room 1건을 결정적으로 선택(귀속가능만 진입).
  --   JOIN LATERAL(inner) → 매칭 room log 없는 전이는 freeze 제외 = 강제귀속 방지.
  CREATE TEMP TABLE _bf_freeze ON COMMIT DROP AS
  SELECT st.id AS st_id, m.assigned_room
  FROM status_transitions st
  JOIN LATERAL (
    SELECT r.assigned_room
    FROM check_in_room_logs r
    WHERE r.check_in_id = st.check_in_id
      AND r.room_type = CASE st.to_status
            WHEN 'consultation'    THEN 'consultation'
            WHEN 'preconditioning' THEN 'treatment'
            WHEN 'laser'           THEN 'laser'
            WHEN 'heated_laser'    THEN 'laser'
            WHEN 'examination'     THEN 'examination'
          END
      AND ABS(EXTRACT(EPOCH FROM (r.logged_at - st.transitioned_at))) <= 300  -- ±5분
    ORDER BY ABS(EXTRACT(EPOCH FROM (r.logged_at - st.transitioned_at))) ASC,
             r.logged_at ASC, r.id ASC
    LIMIT 1
  ) m ON true
  WHERE st.clinic_id = v_clinic
    AND st.room_id IS NULL
    AND st.to_status IN ('consultation','preconditioning','laser','heated_laser','examination');
    -- ↑ 60일 window 없음(all-time) = 기존 백필 커버 밖 older 잔여 포함.

  SELECT COUNT(*) INTO v_freeze FROM _bf_freeze;

  -- ── apply: freeze-set 만 UPDATE (fill-from-NULL, 강제귀속 금지) ──
  UPDATE status_transitions st
     SET room_id = f.assigned_room
    FROM _bf_freeze f
   WHERE st.id = f.st_id
     AND st.room_id IS NULL;   -- 멱등 재확인
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 계측: 백필 후에도 NULL 로 남는 룸수반 전이(귀속불가 = 매칭 room log 부재) 잔차.
  SELECT COUNT(*) INTO v_null_post
    FROM status_transitions st
   WHERE st.clinic_id = v_clinic
     AND st.room_id IS NULL
     AND st.to_status IN ('consultation','preconditioning','laser','heated_laser','examination');

  RAISE NOTICE '[ST-ROOMID-REMAINDER] clinic=% | freeze=% | updated=% | 잔차NULL(귀속불가)=%',
    v_clinic, v_freeze, v_updated, v_null_post;

  -- ── rows-affected == freeze count 가드 ──
  IF v_updated <> v_freeze THEN
    RAISE EXCEPTION '[ST-ROOMID-REMAINDER] ABORT: updated(%) != freeze(%) — 대상셋 불일치(경합/멱등붕괴)',
      v_updated, v_freeze;
  END IF;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';

COMMIT;

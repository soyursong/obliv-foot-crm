-- ════════════════════════════════════════════════════════════════════════════
-- T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM  (P2, foot) — [백필]
-- 과거 60일 룸수반 status_transitions.room_id 를 check_in_room_logs 에서 결정적 소급.
--
-- 배경: room_id 컬럼(TEXT, nullable)은 존재하나 全 INSERT site 가 미기입 → 0/369(0%).
--   캡처 픽스(FE 4곳)는 신규 전이만 채움. 과거 전이는 본 백필로 소급.
-- RC 실증(9sre read-only + DA): 룸수반 전이 순간 check_in_room_logs 에 해당 방 존재
--   (gap median 0.00분 · ±2분 100%). → 결정적(deterministic) 소급 가능.
--
-- 성격: ADDITIVE — 전량 NULL → fill (overwrite 아님, 파괴성 0, DDL 0). 원장 무접점.
--   룸수반 전이 한정: to_status ∈ {consultation, preconditioning, laser, heated_laser, examination}.
--   미수반 전이(registered/_waiting/returning_zone 등)는 대상 밖 → 자연 NULL 유지
--     ("사실상 NOT NULL"은 룸수반 전이 한정 앱레이어 규약 — 스키마 NOT NULL 제약 걸지 않음).
-- 소싱: st.transitioned_at 최근접 check_in_room_logs(같은 check_in + 매칭 room_type),
--   ±5분 window(±2분 100% 실증에 headroom) 내 nearest. 매칭 없으면 NULL 유지(귀속불가 잔차, 계측).
--
-- 멱등: WHERE st.room_id IS NULL (재실행 no-op / 캡처가 이미 채운 신규분 무접촉).
-- 대상셋 freeze: TEMP _bf_freeze(ON COMMIT DROP) 로 대상 id+값 확정 → 동일 셋만 UPDATE.
-- rows-affected 가드: updated == freeze count 아니면 ABORT(경합/멱등붕괴).
-- archive-first: dryrun.mjs 가 freeze-set(st_id + would-fill) 을 evidence JSON 으로 사전 덤프.
--   rollback = 20260730120000_..._backfill.rollback.mjs (archive JSON 의 id-set → room_id NULL 복원).
--   (과거 전이만 대상 → 캡처가 채우는 신규 전이와 시간·id 로 명확 분리.)
-- cross_crm_data_correction_backfill_sop 준수.
-- author: dev-foot / 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $backfill$
DECLARE
  v_clinic  uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브의원 서울오리진점 (foot active)
  v_days    int  := 60;
  v_freeze  int;
  v_updated int;
  v_null_post int;
BEGIN
  -- ── freeze: 대상셋 = room_id NULL + 룸수반 to_status + 60일 이내 + 매칭 room log 존재 ──
  --   각 대상 전이에 대해 시간 최근접(±5분) assigned_room 1건을 결정적으로 선택.
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
    AND st.to_status IN ('consultation','preconditioning','laser','heated_laser','examination')
    AND st.transitioned_at >= now() - (v_days || ' days')::interval;

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
     AND st.to_status IN ('consultation','preconditioning','laser','heated_laser','examination')
     AND st.transitioned_at >= now() - (v_days || ' days')::interval;

  RAISE NOTICE '[ST-ROOMID-BACKFILL] clinic=% days=% | freeze=% | updated=% | 잔차NULL(귀속불가)=%',
    v_clinic, v_days, v_freeze, v_updated, v_null_post;

  -- ── rows-affected == freeze count 가드 ──
  IF v_updated <> v_freeze THEN
    RAISE EXCEPTION '[ST-ROOMID-BACKFILL] ABORT: updated(%) != freeze(%) — 대상셋 불일치(경합/멱등붕괴)',
      v_updated, v_freeze;
  END IF;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';

COMMIT;

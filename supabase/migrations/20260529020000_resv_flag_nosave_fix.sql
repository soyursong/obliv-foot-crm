-- T-20260529-foot-RESV-FLAG-NOSAVE (P2)
-- 예약 접수 시 "예약했어요" 저장 안 됨 — 복합 원인 수정
--
-- ─── 근본 원인 (3가지) ────────────────────────────────────────────────────────
--
-- 원인 1 (DB — 주원인): 취소된 체크인이 예약을 'checked_in' 상태로 묶음
--   시나리오:
--     1. 셀프접수 완료 → trg_checkin_sync_reservation → reservation.status = 'checked_in'
--     2. 스태프가 체크인 취소 → check_in.status = 'cancelled'
--     3. 예약 상태는 여전히 'checked_in' (복원 트리거 없음)
--     4. 고객 재접수 → 예약 조회 status='confirmed' → 없음 → reservation_id = NULL
--   결과: check_ins에 reservation_id = NULL 저장 — 예약 연결 끊어짐
--
-- 원인 2 (FE): 예약 조회 digits 폴백 E164 포맷 불일치
--   '+821012345678'.replace(/\D/g,'') = '821012345678' (12자리)
--   phoneDigits = '01012345678' (11자리) → 불일치 → 매칭 실패
--   (SelfCheckIn.tsx FE 수정으로 별도 처리)
--
-- 원인 3 (FE): 고객명 폴백 없음
--   reservationType='reserved'이지만 전화번호 포맷 불일치 시 고객명으로 재시도 없음
--   (SelfCheckIn.tsx FE 수정으로 별도 처리)
--
-- ─── 이 마이그레이션의 수정 (DB) ────────────────────────────────────────────
-- 1. fn_checkin_cancel_restore_reservation 트리거 함수 신규 생성
--    - check_ins.status → 'cancelled' 업데이트 감지
--    - reservation_id가 있고 예약 status = 'checked_in'이면 → 'confirmed' 복원
--    - SECURITY DEFINER, AFTER UPDATE on check_ins
--
-- 2. 기존 데이터 backfill
--    - 현재 check_in.status = 'cancelled' AND reservation.status = 'checked_in'인 레코드 수정
--    - 이미 다른 활성 체크인이 있는 예약은 제외
--
-- ─── 리스크 ──────────────────────────────────────────────────────────────────
-- LOW: 복원 조건 = (reservation.status = 'checked_in') — 다른 상태(cancelled, completed) 건드리지 않음
-- 복원 후 새 셀프접수 시 trg_checkin_sync_reservation이 다시 'checked_in'으로 세팅
--
-- ─── 롤백 ────────────────────────────────────────────────────────────────────
-- 20260529020000_resv_flag_nosave_fix.rollback.sql
--
-- ticket: T-20260529-foot-RESV-FLAG-NOSAVE
-- author: dev-foot / 2026-05-29

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: fn_checkin_cancel_restore_reservation
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_checkin_cancel_restore_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 체크인 상태가 'cancelled'로 변경되고 reservation_id가 있는 경우에만 실행
  IF NEW.status = 'cancelled'
     AND (OLD.status IS DISTINCT FROM 'cancelled')
     AND NEW.reservation_id IS NOT NULL
  THEN
    -- 예약이 'checked_in' 상태일 때만 'confirmed'로 복원
    -- (cancelled, completed 등 다른 상태는 건드리지 않음)
    UPDATE public.reservations
    SET    status = 'confirmed'
    WHERE  id     = NEW.reservation_id
      AND  status = 'checked_in';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_checkin_cancel_restore_reservation IS
  'T-20260529-foot-RESV-FLAG-NOSAVE: 체크인 취소 시 연결된 예약을 confirmed로 복원.'
  ' check_in.status→cancelled + reservation.status=checked_in → reservation.status→confirmed.'
  ' 이렇게 해야 고객이 재접수할 때 예약 조회(status=confirmed)에서 예약을 찾아 reservation_id를 연결할 수 있음.';

ALTER FUNCTION public.fn_checkin_cancel_restore_reservation() OWNER TO postgres;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: 트리거 등록 (AFTER UPDATE on check_ins)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_checkin_cancel_restore_reservation ON public.check_ins;

CREATE TRIGGER trg_checkin_cancel_restore_reservation
  AFTER UPDATE ON public.check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_checkin_cancel_restore_reservation();

COMMENT ON TRIGGER trg_checkin_cancel_restore_reservation ON public.check_ins IS
  'T-20260529-foot-RESV-FLAG-NOSAVE: 체크인 취소 시 예약 상태 복원.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: 기존 데이터 backfill
-- ─ 현재 상태: check_in cancelled + reservation checked_in + 다른 활성 체크인 없음
-- ─ 이미 다른 활성 체크인이 연결된 예약은 제외 (복원하면 중복 접수 가능 → 위험)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_backfill_count INTEGER;
BEGIN
  -- 조건:
  --   1. check_ins.status = 'cancelled'
  --   2. check_ins.reservation_id IS NOT NULL
  --   3. reservations.status = 'checked_in' (trg_checkin_sync_reservation에 의해 세팅됨)
  --   4. 동일 reservation_id를 가진 활성(non-cancelled) 체크인이 없음
  UPDATE public.reservations r
  SET    status = 'confirmed'
  FROM   public.check_ins ci
  WHERE  ci.reservation_id = r.id
    AND  ci.status         = 'cancelled'
    AND  r.status          = 'checked_in'
    -- 이미 다른 활성 체크인이 있으면 제외
    AND  NOT EXISTS (
      SELECT 1
      FROM   public.check_ins ci2
      WHERE  ci2.reservation_id = r.id
        AND  ci2.status        <> 'cancelled'
    );

  GET DIAGNOSTICS v_backfill_count = ROW_COUNT;
  RAISE NOTICE 'T-20260529-foot-RESV-FLAG-NOSAVE backfill: % 예약 confirmed 복원', v_backfill_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: 검증
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 트리거 존재 확인
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_trigger
    WHERE  tgname    = 'trg_checkin_cancel_restore_reservation'
      AND  tgrelid   = 'public.check_ins'::regclass
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: trg_checkin_cancel_restore_reservation 트리거 없음';
  END IF;

  -- 함수 존재 확인
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  p.proname  = 'fn_checkin_cancel_restore_reservation'
      AND  n.nspname  = 'public'
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: fn_checkin_cancel_restore_reservation 함수 없음';
  END IF;

  RAISE NOTICE 'T-20260529-foot-RESV-FLAG-NOSAVE DB fix: trg_checkin_cancel_restore_reservation 등록 완료.';
  RAISE NOTICE '  체크인 취소 시 예약 checked_in → confirmed 자동 복원.';
  RAISE NOTICE '  기존 데이터 backfill 완료 (결과: NOTICE 참조).';
END;
$$;

COMMIT;

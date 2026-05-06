-- T-20260506-foot-SELFCHECKIN-MERGE: 셀프접수 ↔ 예약 merge 트리거
--
-- Root Cause:
--   SelfCheckIn.tsx의 anon 클라이언트는 reservations UPDATE RLS 권한 없음.
--   체크인 생성 후 reservation status → checked_in 업데이트가 묵살됨.
--   결과: 대시보드에 예약 박스(confirmed 유지) + 체크인 박스 → 이중 박스 발생.
--
-- Fix:
--   SECURITY DEFINER 트리거 fn_checkin_sync_reservation()
--   check_ins AFTER INSERT → reservation_id가 있으면 연결된 예약을 checked_in으로 업데이트.
--   SECURITY DEFINER = anon RLS 우회, DB 레벨 원자적 처리.
--
-- Rollback: 20260506000010_selfcheckin_merge_trigger.down.sql
-- Ticket: T-20260506-foot-SELFCHECKIN-MERGE
-- Applied: 2026-05-06

BEGIN;

-- 체크인-예약 동기화 함수 (SECURITY DEFINER: anon RLS 우회)
CREATE OR REPLACE FUNCTION fn_checkin_sync_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 셀프접수(anon) 또는 관리자 접수 시, reservation_id가 연결된 경우
  -- 해당 예약을 confirmed → checked_in으로 자동 전환
  IF NEW.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET status = 'checked_in'
    WHERE id = NEW.reservation_id
      AND status = 'confirmed';
  END IF;
  RETURN NEW;
END;
$$;

-- 기존 트리거 제거 후 재생성
DROP TRIGGER IF EXISTS trg_checkin_sync_reservation ON public.check_ins;
CREATE TRIGGER trg_checkin_sync_reservation
  AFTER INSERT ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION fn_checkin_sync_reservation();

-- 함수 소유권: postgres (SECURITY DEFINER 보안 강화)
ALTER FUNCTION fn_checkin_sync_reservation() OWNER TO postgres;

COMMIT;

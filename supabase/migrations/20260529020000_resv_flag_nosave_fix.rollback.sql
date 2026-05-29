-- T-20260529-foot-RESV-FLAG-NOSAVE rollback
-- 20260529020000_resv_flag_nosave_fix.sql 의 DB 변경 취소

BEGIN;

-- 트리거 제거
DROP TRIGGER IF EXISTS trg_checkin_cancel_restore_reservation ON public.check_ins;

-- 함수 제거
DROP FUNCTION IF EXISTS public.fn_checkin_cancel_restore_reservation();

-- backfill 복원 (reservation.status → 'confirmed'로 바꾼 건 되돌리기 불가 — 수동 복원 필요)
-- 아래는 cancelled 체크인이 있고 현재 confirmed인 예약을 확인하는 참고 쿼리
-- SELECT r.id, r.status, ci.status AS ci_status, ci.cancelled_at
-- FROM reservations r
-- JOIN check_ins ci ON ci.reservation_id = r.id
-- WHERE ci.status = 'cancelled' AND r.status = 'confirmed';

RAISE NOTICE 'T-20260529-foot-RESV-FLAG-NOSAVE: 트리거/함수 제거 완료. backfill 취소는 수동 필요.';

COMMIT;

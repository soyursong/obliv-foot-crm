-- T-20260525-foot-RESV-CANCEL-CTX: reservations.cancelled_by 컬럼 추가
-- 컨텍스트메뉴 예약 취소 경로에서 취소 처리 직원 user_id 기록

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT NULL;

COMMENT ON COLUMN reservations.cancelled_by IS '취소 처리 직원 user_id — T-20260525-foot-RESV-CANCEL-CTX';

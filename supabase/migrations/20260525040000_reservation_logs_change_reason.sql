-- T-20260525-foot-RESV-CHANGE-REASON: reservation_logs.change_reason 컬럼 추가
-- 통합시간표 예약 변경 시 사유를 로그 레코드에 저장

ALTER TABLE reservation_logs
  ADD COLUMN IF NOT EXISTS change_reason TEXT NULL;

COMMENT ON COLUMN reservation_logs.change_reason IS '예약 변경 사유 (optional) — T-20260525-foot-RESV-CHANGE-REASON';

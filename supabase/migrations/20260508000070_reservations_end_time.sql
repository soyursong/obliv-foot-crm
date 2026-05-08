-- T-20260508-foot-C2-RESV-DETAIL-PANEL: 예약 종료 시간 컬럼 추가
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS end_time TIME;
COMMENT ON COLUMN reservations.end_time IS '예약 종료 시간 (HH:MM) — C2-RESV-DETAIL-PANEL';

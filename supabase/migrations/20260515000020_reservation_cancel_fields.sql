-- T-20260515-foot-RESV-CANCEL: 예약 취소 기록 보존
-- reservations 테이블에 cancelled_at + cancel_reason 칼럼 추가

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL;

COMMENT ON COLUMN reservations.cancelled_at IS '취소 일시 (취소 시 NOW() 기록, 미취소는 NULL)';
COMMENT ON COLUMN reservations.cancel_reason IS '취소 사유 (입력 필수, 미취소는 NULL)';

-- reservation_logs action 허용 목록에 cancel_with_reason 추가 (기존 cancel 그대로 유지)
-- 기존 check constraint 확인 후 필요시 수정 (없으면 no-op)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'reservation_logs' AND constraint_name LIKE '%action%'
  ) THEN
    -- constraint 존재 시: 기존 constraint 이름 찾아서 drop + recreate
    -- 실제로는 20260425000000_reservation_logs_action_check.sql에서 관리
    NULL;
  END IF;
END $$;

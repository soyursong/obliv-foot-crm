-- T-20260525-foot-RESV-CHANGE-REASON rollback: change_reason 컬럼 제거

ALTER TABLE reservation_logs
  DROP COLUMN IF EXISTS change_reason;

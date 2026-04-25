-- Rollback for T-20260420-foot-044
ALTER TABLE reservation_logs DROP CONSTRAINT IF EXISTS reservation_logs_action_check;

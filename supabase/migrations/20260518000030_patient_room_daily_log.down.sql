-- Rollback: T-20260516-foot-ROOM-MOVE-TRACK
BEGIN;

DROP TABLE IF EXISTS patient_room_daily_log;

-- check_in_room_logs CHECK constraint 원복 (heated_laser 제거)
ALTER TABLE check_in_room_logs
  DROP CONSTRAINT IF EXISTS check_in_room_logs_room_type_check;

ALTER TABLE check_in_room_logs
  ADD CONSTRAINT check_in_room_logs_room_type_check
  CHECK (room_type IN ('examination', 'consultation', 'treatment', 'laser'));

COMMIT;

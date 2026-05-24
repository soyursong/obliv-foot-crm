-- Rollback: T-20260523-foot-ROOM-DISABLE-TOGGLE carry_over 컬럼 제거
BEGIN;
DROP INDEX IF EXISTS daily_room_status_carry_over_idx;
ALTER TABLE daily_room_status DROP COLUMN IF EXISTS carry_over;
COMMIT;

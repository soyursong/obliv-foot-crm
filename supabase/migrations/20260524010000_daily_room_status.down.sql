-- Rollback: T-20260523-foot-SPACE-DASH-AUTOSYNC daily_room_status 제거
BEGIN;
DROP TABLE IF EXISTS daily_room_status;
COMMIT;

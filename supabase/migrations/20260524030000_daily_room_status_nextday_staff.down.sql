-- Rollback: T-20260524-foot-ROOM-NEXTDAY-STAFF
-- disabled_by + CHECK + 신규 RLS 정책 제거, 원복
BEGIN;

-- 4. 인덱스 제거
DROP INDEX IF EXISTS daily_room_status_disabled_by_idx;

-- 3b. staff 정책 제거
DROP POLICY IF EXISTS daily_room_status_staff_own_write ON daily_room_status;

-- 3a. admin/manager 정책 → 원래 이름으로 복구
DROP POLICY IF EXISTS daily_room_status_admin_manager_write ON daily_room_status;

CREATE POLICY daily_room_status_admin_all ON daily_room_status
  FOR ALL TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

-- 2. CHECK 제약 제거
ALTER TABLE daily_room_status
  DROP CONSTRAINT IF EXISTS daily_room_status_date_max_nextday;

-- 1. disabled_by 컬럼 제거
ALTER TABLE daily_room_status
  DROP COLUMN IF EXISTS disabled_by;

COMMIT;

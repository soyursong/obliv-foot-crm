-- Rollback: T-20260526-foot-STAFF-CANCEL-ERR
-- 이 마이그레이션은 ADD COLUMN IF NOT EXISTS + NOTIFY 만이므로
-- 실질적 롤백은 없음 (컬럼 삭제는 20260525000001_reservation_cancel_by.down.sql 참조)
-- NOTIFY 는 롤백 불필요 (메모리 상태).
SELECT 1; -- NOOP

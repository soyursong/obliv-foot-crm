-- Rollback: T-20260520-foot-STAFF-CHECKIN-INSERT
-- check_ins_staff_insert 정책 제거
--
-- 주의: is_floor_staff() 함수는 제거하지 않음.
--   → check_ins_staff_update 정책(T-20260520-foot-CHECKIN-RLS-STAFF)이 동일 함수 참조.
--   → 함수 제거가 필요한 경우 20260520000060_check_ins_staff_update_rls.down.sql 단독 실행.

DROP POLICY IF EXISTS check_ins_staff_insert ON check_ins;

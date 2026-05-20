-- Rollback: T-20260520-foot-CHECKIN-RLS-STAFF
-- check_ins_staff_update 정책 + is_floor_staff() 헬퍼 제거

DROP POLICY IF EXISTS check_ins_staff_update ON check_ins;
DROP FUNCTION IF EXISTS is_floor_staff();

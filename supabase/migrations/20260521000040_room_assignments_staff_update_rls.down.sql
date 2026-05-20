-- Rollback: T-20260520-foot-STAFF-ROOM-ASSIGN
-- room_assignments_staff_update 정책 제거
--
-- 주의: is_floor_staff() 함수는 check_ins·reservations 정책에서도 사용 중.
--       함수 자체는 DROP하지 않음. 정책만 제거.

DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;

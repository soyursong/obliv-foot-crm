-- Rollback: T-20260522-foot-STAFF-REEXPAND (customers)
-- customers_staff_update 정책 제거
-- 주의: is_floor_staff() 함수는 다른 정책에서도 사용 중 — DROP 하지 않음

DROP POLICY IF EXISTS customers_staff_update ON customers;

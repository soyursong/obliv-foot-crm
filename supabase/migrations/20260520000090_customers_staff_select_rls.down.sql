-- Rollback: T-20260520-foot-CUSTOMER-SELECT-RLS
-- customers_staff_select 정책 제거
-- is_floor_staff()는 20260520000060_check_ins_staff_update_rls.down.sql 에서 관리
-- (여기서는 제거하지 않음 — check_ins UPDATE 정책도 이 함수에 의존)

DROP POLICY IF EXISTS customers_staff_select ON customers;

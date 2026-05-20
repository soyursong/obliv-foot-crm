-- T-20260520-foot-STAFF-CUSTOMER-UPDATE 롤백
-- customers_staff_update 정책 제거

DROP POLICY IF EXISTS customers_staff_update ON customers;

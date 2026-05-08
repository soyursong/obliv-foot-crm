-- ROLLBACK: T-20260508-foot-CUST-FORM-REVAMP Phase A
-- 실행 전 데이터 백업 권장: SELECT * FROM customers LIMIT 0; → 구조 확인

ALTER TABLE customers
  DROP COLUMN IF EXISTS customer_grade,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS passport_number,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS assigned_staff_role,
  DROP COLUMN IF EXISTS privacy_consent,
  DROP COLUMN IF EXISTS sms_reject,
  DROP COLUMN IF EXISTS marketing_reject;

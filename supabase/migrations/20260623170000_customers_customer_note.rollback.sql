-- 롤백: T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD
-- customers.customer_note 컬럼 제거. ADDITIVE nullable 컬럼이므로 제거 시 기존 기능 무영향.

BEGIN;

ALTER TABLE customers
  DROP COLUMN IF EXISTS customer_note;

COMMIT;

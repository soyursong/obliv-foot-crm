-- ROLLBACK: T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE

-- 1. audit 이력 테이블 제거
DROP POLICY IF EXISTS "payment_audit_logs_open" ON payment_audit_logs;
DROP TABLE IF EXISTS payment_audit_logs;

-- 2. payments 컬럼 제거
ALTER TABLE payments
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS delete_reason,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancel_reason;

DROP INDEX IF EXISTS idx_payments_status;

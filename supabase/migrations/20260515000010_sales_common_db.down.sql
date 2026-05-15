-- ROLLBACK: T-20260515-foot-SALES-COMMON-DB
-- 순서: 트리거 → claim_diagnoses → 컬럼 제거

DROP TRIGGER IF EXISTS trg_payments_accounting_date_insert ON payments;
DROP FUNCTION IF EXISTS trg_payments_set_accounting_date();
DROP TRIGGER IF EXISTS trg_pkg_payments_accounting_date_insert ON package_payments;
DROP FUNCTION IF EXISTS trg_pkg_payments_set_accounting_date();

DROP TABLE IF EXISTS claim_diagnoses;

ALTER TABLE payments
  DROP COLUMN IF EXISTS parent_payment_id,
  DROP COLUMN IF EXISTS exclude_tax_report,
  DROP COLUMN IF EXISTS appr_info,
  DROP COLUMN IF EXISTS tax_type,
  DROP COLUMN IF EXISTS origin_tx_date,
  DROP COLUMN IF EXISTS accounting_date;

ALTER TABLE package_payments
  DROP COLUMN IF EXISTS parent_payment_id,
  DROP COLUMN IF EXISTS exclude_tax_report,
  DROP COLUMN IF EXISTS appr_info,
  DROP COLUMN IF EXISTS tax_type,
  DROP COLUMN IF EXISTS origin_tx_date,
  DROP COLUMN IF EXISTS accounting_date;

DROP INDEX IF EXISTS idx_payments_accounting_date;
DROP INDEX IF EXISTS idx_pkg_payments_accounting_date;
DROP INDEX IF EXISTS idx_payments_parent;
DROP INDEX IF EXISTS idx_pkg_payments_parent;

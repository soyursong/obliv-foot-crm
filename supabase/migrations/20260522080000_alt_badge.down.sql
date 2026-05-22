-- T-20260522-foot-ALT-BADGE rollback

-- (2) reservation_memo_history
DROP INDEX IF EXISTS idx_rmh_customer_pinned;
ALTER TABLE reservation_memo_history
  DROP COLUMN IF EXISTS is_pinned,
  DROP COLUMN IF EXISTS pinned_at;

-- (1) customers
DROP INDEX IF EXISTS idx_customers_alt_status;
ALTER TABLE customers
  DROP COLUMN IF EXISTS alt_status,
  DROP COLUMN IF EXISTS alt_detail,
  DROP COLUMN IF EXISTS alt_activated_at;

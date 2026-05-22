-- T-20260522-foot-DESIGNATED-THERAPIST — ROLLBACK
-- designated_therapist_id 컬럼 + 인덱스 제거

DROP INDEX IF EXISTS idx_customers_designated_therapist;

ALTER TABLE customers
  DROP COLUMN IF EXISTS designated_therapist_id;

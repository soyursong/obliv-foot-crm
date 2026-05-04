-- ROLLBACK: T-20260504-foot-MEMO-RESTRUCTURE
-- booking_memo / customer_memo 분리 롤백
-- 신규 컬럼 → 기존 memo 복원 후 신규 컬럼 DROP

BEGIN;

-- 1. 기존 memo 필드 복원 (booking_memo → reservations.memo)
UPDATE reservations
  SET memo = booking_memo
  WHERE booking_memo IS NOT NULL;

-- 2. 기존 memo 필드 복원 (customer_memo → customers.memo)
UPDATE customers
  SET memo = customer_memo
  WHERE customer_memo IS NOT NULL;

-- 3. 신규 컬럼 삭제
ALTER TABLE reservations
  DROP COLUMN IF EXISTS booking_memo;

ALTER TABLE customers
  DROP COLUMN IF EXISTS customer_memo;

COMMIT;

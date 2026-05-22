-- T-20260522-foot-CLOSING-REFUND — 롤백
DROP FUNCTION IF EXISTS refund_single_payment(UUID, UUID, INTEGER, TEXT, TEXT);
DROP INDEX IF EXISTS idx_payments_linked;
ALTER TABLE payments DROP COLUMN IF EXISTS linked_payment_id;

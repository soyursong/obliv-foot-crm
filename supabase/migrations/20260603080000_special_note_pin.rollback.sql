-- ROLLBACK: T-20260603-foot-RX-CHART-FOLLOWUP2 #10 특이사항 핀 고정
-- 20260603080000_special_note_pin.sql 역연산.

BEGIN;

DROP FUNCTION IF EXISTS set_special_note_pin(uuid, boolean);
DROP INDEX IF EXISTS idx_csn_pin_order;

ALTER TABLE customer_special_notes DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE customer_special_notes DROP COLUMN IF EXISTS is_pinned;

COMMIT;

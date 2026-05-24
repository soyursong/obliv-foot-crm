-- T-20260525-foot-RESV-CANCEL-CTX: rollback
ALTER TABLE reservations DROP COLUMN IF EXISTS cancelled_by;

-- T-20260515-foot-RESV-CANCEL: 롤백
ALTER TABLE reservations DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE reservations DROP COLUMN IF EXISTS cancel_reason;

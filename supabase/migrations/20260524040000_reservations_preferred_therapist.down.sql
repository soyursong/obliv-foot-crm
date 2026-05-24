-- T-20260524-foot-THERAPIST-BISYNC 롤백
DROP INDEX IF EXISTS idx_reservations_preferred_therapist;
ALTER TABLE reservations DROP COLUMN IF EXISTS preferred_therapist_id;

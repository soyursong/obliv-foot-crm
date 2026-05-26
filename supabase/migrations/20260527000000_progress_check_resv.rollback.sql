-- ============================================================
-- ROLLBACK: T-20260526-foot-PROGRESS-CHECKPOINT Phase 2
-- 20260527000000_progress_check_resv.sql 의 역방향
-- ============================================================

BEGIN;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS progress_check_required,
  DROP COLUMN IF EXISTS progress_check_label;

DROP INDEX IF EXISTS idx_reservations_progress_check;

COMMIT;

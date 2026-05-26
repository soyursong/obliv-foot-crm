-- ============================================================
-- ROLLBACK: T-20260526-foot-PROGRESS-CHECKPOINT Phase 1
-- 20260526170000_progress_plans.sql 의 역방향
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.package_progress_plans CASCADE;

COMMIT;

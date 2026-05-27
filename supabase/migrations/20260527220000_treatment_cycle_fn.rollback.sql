-- ============================================================
-- ROLLBACK: T-20260527-foot-TREATMENT-CYCLE-ALERT
-- ============================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_treatment_cycle_counts(UUID, UUID[]) FROM authenticated;
DROP FUNCTION IF EXISTS public.get_treatment_cycle_counts(UUID, UUID[]);
DROP INDEX IF EXISTS public.idx_check_ins_done_customer;

COMMIT;

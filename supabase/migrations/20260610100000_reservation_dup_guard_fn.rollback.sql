-- ROLLBACK: T-20260610-foot-RESV-DUPGUARD-SAMEDAY
-- fn_reservation_dup_guard 함수 제거. FE 는 자동으로 fallback SELECT 로 강하(graceful).
BEGIN;
DROP FUNCTION IF EXISTS public.fn_reservation_dup_guard(UUID, UUID, TEXT, DATE);
COMMIT;

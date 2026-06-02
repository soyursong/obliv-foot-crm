-- ROLLBACK: T-20260602-foot-SELFCHECKIN-DUP-GUARD
-- fn_selfcheckin_dup_guard 함수 제거. FE 는 자동으로 fallback SELECT 로 강하(graceful).
BEGIN;
DROP FUNCTION IF EXISTS public.fn_selfcheckin_dup_guard(UUID, UUID, TEXT, DATE);
COMMIT;

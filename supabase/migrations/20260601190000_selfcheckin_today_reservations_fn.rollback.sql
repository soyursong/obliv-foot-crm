-- 롤백: T-20260601-foot-SELFLOGIN-RESV-LIST-QR
-- fn_selfcheckin_today_reservations 제거

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_today_reservations(UUID, DATE);

COMMIT;

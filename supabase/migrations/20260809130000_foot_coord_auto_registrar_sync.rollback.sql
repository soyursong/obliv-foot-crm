-- ROLLBACK for 20260809130000_foot_coord_auto_registrar_sync.sql
-- T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC
-- 긴급 revert 전용. staff_id 링크 컬럼 DROP 시 provenance 링크 소실(수동 재연동 필요) — 의도된 revert 에서만 실행.
BEGIN;

DROP TRIGGER IF EXISTS trg_foot_coord_autosync_registrar ON public.staff;
DROP FUNCTION IF EXISTS public.fn_foot_coord_autosync_registrar();
DROP INDEX IF EXISTS public.reservation_registrars_staff_group_uidx;
ALTER TABLE public.reservation_registrars DROP COLUMN IF EXISTS staff_id;

COMMIT;

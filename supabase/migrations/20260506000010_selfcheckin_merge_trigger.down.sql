-- Rollback: T-20260506-foot-SELFCHECKIN-MERGE trigger

DROP TRIGGER IF EXISTS trg_checkin_sync_reservation ON public.check_ins;
DROP FUNCTION IF EXISTS fn_checkin_sync_reservation();

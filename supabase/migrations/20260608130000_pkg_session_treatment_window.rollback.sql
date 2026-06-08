-- ROLLBACK: T-20260608-foot-TICKET-DEDUCT-SLOT-DATA (AC4)
-- 20260608130000_pkg_session_treatment_window.sql 역적용
BEGIN;

ALTER TABLE public.package_sessions DROP COLUMN IF EXISTS treatment_started_at;
ALTER TABLE public.package_sessions DROP COLUMN IF EXISTS treatment_ended_at;

COMMIT;

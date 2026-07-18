-- ROLLBACK: 20260701030000_customer_export_audit.sql
--   T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND ④ export audit 전면 제거.
--   ★감사 trail 데이터 폐기 주의 — 운영 적재 후 롤백 시 customer_export_audit row 소실.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_log_customer_export(TEXT, INTEGER, JSONB);

DROP POLICY IF EXISTS custexport_audit_select ON public.customer_export_audit;

DROP INDEX IF EXISTS public.idx_custexport_audit_actor;
DROP INDEX IF EXISTS public.idx_custexport_audit_clinic_id;

DROP TABLE IF EXISTS public.customer_export_audit;

COMMIT;

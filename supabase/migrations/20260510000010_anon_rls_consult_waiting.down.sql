-- Rollback: 20260510000010_anon_rls_consult_waiting.sql
-- consult_waiting 제거 — registered + treatment_waiting 만 허용으로 복원

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting')
  );

COMMIT;

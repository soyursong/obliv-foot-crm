-- Rollback: T-20260514-foot-CHECKIN-AUTO-STAGE anon RLS 정책
-- consult_waiting 제거 → registered + treatment_waiting으로 복원

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting')
  );

COMMIT;

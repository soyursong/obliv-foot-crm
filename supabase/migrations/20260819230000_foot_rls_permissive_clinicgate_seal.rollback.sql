-- ============================================================================
-- T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL · ROLLBACK (DROP 6)
--   RESTRICTIVE clinic-gate 봉인 해제 → cross-clinic authenticated 도달 재개통(취약 복원).
--   완전가역: permissive 정책은 UP 에서 무접촉 → DROP 6줄로 원상 복귀.
-- ============================================================================
DROP POLICY IF EXISTS "clinical_images_clinic_gate_restrict" ON public.clinical_images;
DROP POLICY IF EXISTS "consent_forms_clinic_gate_restrict"   ON public.consent_forms;
DROP POLICY IF EXISTS "message_logs_clinic_gate_restrict"    ON public.message_logs;
DROP POLICY IF EXISTS "service_charges_clinic_gate_restrict" ON public.service_charges;
DROP POLICY IF EXISTS "checklists_clinic_gate_restrict"      ON public.checklists;
DROP POLICY IF EXISTS "packages_clinic_read_restrict"        ON public.packages;

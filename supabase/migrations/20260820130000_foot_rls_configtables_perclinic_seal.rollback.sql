-- ============================================================================
-- T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE · DOWN (rollback)
--   신설 RESTRICTIVE 정책 3종만 DROP → 이전 상태(permissive-only + anon_deny) 완전 복원.
--   permissive 정책은 UP 에서 무DROP(ADDITIVE) → 재생성 불요.
--   anon_deny(form_templates/code_availability)=부모 leg 소관 → 본 rollback 무접촉.
--   ⚠ rollback = cross-clinic read/write 재개통. 회귀 아님(원상 복구).
-- ============================================================================

-- (A) config per-clinic seal
DROP POLICY IF EXISTS "form_templates_clinic_read_restrict"    ON public.form_templates;
DROP POLICY IF EXISTS "treatment_sets_clinic_gate_restrict"    ON public.treatment_sets;
DROP POLICY IF EXISTS "code_availability_clinic_read_restrict" ON public.code_availability;

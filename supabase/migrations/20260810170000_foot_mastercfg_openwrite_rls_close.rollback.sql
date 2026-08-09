-- ============================================================================
-- T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE · DOWN (rollback)
--   UP(20260810170000_foot_mastercfg_openwrite_rls_close.sql)의 정확한 역연산.
--   canonical 정책 DROP → auth_all(USING(true)/WITH CHECK(true)) before-image verbatim 복원.
--   before-image 출처: census raw_policies_2026-08-10.json (fee_set_templates.auth_all / package_templates.auth_all).
--   데이터 mutation 0 · 비파괴 · 멱등.
--   ⚠ 보안 하드닝의 rollback = ungated write 재개통(보안홀 재개방) — 사고 대응(정당 writer 회귀) 시에만 사용.
--     발동 시 즉시 role-set 재판정(FOLLOWUP → planner/DA).
-- ============================================================================

-- ── ② package_templates : split canonical 4정책 DROP → auth_all verbatim 복원 ──
DROP POLICY IF EXISTS "package_templates_staff_read"   ON public.package_templates;
DROP POLICY IF EXISTS "package_templates_staff_insert" ON public.package_templates;
DROP POLICY IF EXISTS "package_templates_staff_update" ON public.package_templates;
DROP POLICY IF EXISTS "package_templates_staff_delete" ON public.package_templates;
DROP POLICY IF EXISTS "auth_all" ON public.package_templates;
CREATE POLICY "auth_all" ON public.package_templates
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── ① fee_set_templates : canonical DROP → auth_all verbatim 복원 ──
DROP POLICY IF EXISTS "fee_set_templates_staff_clinic_all" ON public.fee_set_templates;
DROP POLICY IF EXISTS "auth_all" ON public.fee_set_templates;
CREATE POLICY "auth_all" ON public.fee_set_templates
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

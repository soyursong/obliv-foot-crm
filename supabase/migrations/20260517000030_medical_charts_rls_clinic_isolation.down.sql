-- T-20260515-foot-MEDICAL-CHART-V1: RLS 격리 롤백
-- 20260517000030_medical_charts_rls_clinic_isolation.sql 롤백

-- ── chart_doctor_memos: 원상복구 ─────────────────────────────────────────────
DROP POLICY IF EXISTS "cdm_director_clinic" ON chart_doctor_memos;

CREATE POLICY "cdm_director_only" ON chart_doctor_memos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  );

-- ── medical_charts: 원상복구 ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "mc_clinic_isolated" ON medical_charts;

CREATE POLICY "mc_authenticated_all" ON medical_charts
  FOR ALL TO authenticated
  USING  (true)
  WITH CHECK (true);

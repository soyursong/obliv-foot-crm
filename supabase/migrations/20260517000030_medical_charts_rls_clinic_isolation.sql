-- T-20260515-foot-MEDICAL-CHART-V1: FIX RLS — clinic_id 멀티테넌트 격리
-- supervisor QA NO-GO 항목 [2]: mc_authenticated_all → mc_clinic_isolated
-- rollback: 20260517000030_medical_charts_rls_clinic_isolation.down.sql
-- current_user_clinic_id() 함수: 20260426000000_rls_role_separation.sql:35-42

-- ── medical_charts: USING(true) → clinic_id 격리 ─────────────────────────────
DROP POLICY IF EXISTS "mc_authenticated_all" ON medical_charts;

CREATE POLICY "mc_clinic_isolated" ON medical_charts
  FOR ALL TO authenticated
  USING  (clinic_id = current_user_clinic_id())
  WITH CHECK (clinic_id = current_user_clinic_id());

-- ── chart_doctor_memos: clinic_id 조건 추가 (director/admin + clinic 격리) ───
DROP POLICY IF EXISTS "cdm_director_only" ON chart_doctor_memos;

CREATE POLICY "cdm_director_clinic" ON chart_doctor_memos
  FOR ALL TO authenticated
  USING (
    clinic_id = current_user_clinic_id()
    AND EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()
    AND EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('director', 'admin')
    )
  );

-- ── 검증 ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'medical_charts'
       AND policyname = 'mc_clinic_isolated'
  ) THEN
    RAISE EXCEPTION 'medical_charts RLS 정책 mc_clinic_isolated 생성 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'chart_doctor_memos'
       AND policyname = 'cdm_director_clinic'
  ) THEN
    RAISE EXCEPTION 'chart_doctor_memos RLS 정책 cdm_director_clinic 생성 실패';
  END IF;
END $$;

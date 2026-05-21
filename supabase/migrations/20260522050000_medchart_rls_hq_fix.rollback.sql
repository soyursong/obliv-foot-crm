-- ROLLBACK: T-20260522-foot-MEDCHART-SAVE-ERR RLS hotfix
-- v2 정책 제거 + 원본 정책 복원

DROP POLICY IF EXISTS "mc_clinic_isolated_v2"  ON medical_charts;
DROP POLICY IF EXISTS "cdm_director_clinic_v2" ON chart_doctor_memos;

-- 원본 정책 복원
CREATE POLICY "mc_clinic_isolated" ON medical_charts
  FOR ALL TO authenticated
  USING  (clinic_id = current_user_clinic_id())
  WITH CHECK (clinic_id = current_user_clinic_id());

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

-- gh.lee clinic_id 원복 (HQ 계정이므로 NULL이 원래 상태)
UPDATE user_profiles
  SET clinic_id = NULL
  WHERE id = '5c031ae1-739d-4a62-a8e9-5ad81635466b'
    AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

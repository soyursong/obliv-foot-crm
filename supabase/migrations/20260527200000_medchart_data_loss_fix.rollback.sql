-- T-20260527-foot-MEDCHART-DATA-LOSS 롤백
-- 실행 시: v3 → v2 정책 복원, marissong clinic_id NULL 복원 (주의: 재현 가능)

DROP POLICY IF EXISTS "mc_clinic_isolated_v3" ON medical_charts;

CREATE POLICY "mc_clinic_isolated_v2" ON medical_charts
  FOR ALL TO authenticated
  USING (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager')
    )
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager')
    )
  );

-- 주의: marissong clinic_id 복원은 의도적 재현이므로 기본 제외
-- 필요 시 수동으로:
-- UPDATE user_profiles SET clinic_id = NULL WHERE id = '4d0d5d5b-e582-4ea2-8d41-17083cacd909';

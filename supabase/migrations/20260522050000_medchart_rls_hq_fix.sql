-- T-20260522-foot-MEDCHART-SAVE-ERR: medical_charts + chart_doctor_memos RLS hotfix
-- rollback: 20260522050000_medchart_rls_hq_fix.rollback.sql
--
-- 루트 코즈: user_profiles.clinic_id = NULL인 admin/director/HQ 계정이
--   mc_clinic_isolated WITH CHECK (clinic_id = current_user_clinic_id()) 에서
--   NULL 비교 → FALSE 로 평가되어 INSERT/UPDATE 완전 차단.
--   MEDCHART-REVAMP(b8f0090)의 `if (error) throw error` 가 이를 에러 토스트로 노출.
--
-- 수정:
--   1. mc_clinic_isolated → mc_clinic_isolated_v2: NULL clinic_id admin/director 허용
--   2. cdm_director_clinic → cdm_director_clinic_v2: 동일 패턴
--   3. gh.lee@medibuilder.com (5c031ae1) clinic_id 보정

-- ── 1. medical_charts RLS ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "mc_clinic_isolated"     ON medical_charts;
DROP POLICY IF EXISTS "mc_clinic_isolated_v2"  ON medical_charts;

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

-- ── 2. chart_doctor_memos RLS ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "cdm_director_clinic"    ON chart_doctor_memos;
DROP POLICY IF EXISTS "cdm_director_clinic_v2" ON chart_doctor_memos;

CREATE POLICY "cdm_director_clinic_v2" ON chart_doctor_memos
  FOR ALL TO authenticated
  USING (
    (
      clinic_id = current_user_clinic_id()::text
      AND EXISTS (
        SELECT 1 FROM user_profiles
         WHERE id = auth.uid()
           AND role IN ('director', 'admin')
      )
    )
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director')
    )
  )
  WITH CHECK (
    (
      clinic_id = current_user_clinic_id()::text
      AND EXISTS (
        SELECT 1 FROM user_profiles
         WHERE id = auth.uid()
           AND role IN ('director', 'admin')
      )
    )
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director')
    )
  );

-- ── 3. clinic_id=NULL 사용자 보정 ─────────────────────────────────────────────
-- gh.lee@medibuilder.com (이광현 팀장, admin) → 풋센터 클리닉 배정

UPDATE user_profiles
  SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  WHERE id = '5c031ae1-739d-4a62-a8e9-5ad81635466b'
    AND clinic_id IS NULL;

-- ── 4. 검증 ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'medical_charts'
       AND policyname = 'mc_clinic_isolated_v2'
  ) THEN
    RAISE EXCEPTION 'medical_charts: mc_clinic_isolated_v2 정책 생성 실패';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'chart_doctor_memos'
       AND policyname = 'cdm_director_clinic_v2'
  ) THEN
    RAISE EXCEPTION 'chart_doctor_memos: cdm_director_clinic_v2 정책 생성 실패';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'medical_charts'
       AND policyname = 'mc_clinic_isolated'
  ) THEN
    RAISE EXCEPTION '구 정책 mc_clinic_isolated 가 아직 남아있음';
  END IF;
END $$;

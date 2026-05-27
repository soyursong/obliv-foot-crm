-- T-20260527-foot-MEDCHART-DATA-LOSS: 진료차트 유실 반복 수정 (P1)
-- 루트 코즈 #1: marissong@oblivseoul.kr (coordinator, id=4d0d5d5b) clinic_id=NULL
--   → mc_clinic_isolated_v2: NULL!=74967aea → USING FALSE → 0건 반환 (RLS 차단)
--   → 동일 패턴 3번째 반복: gh.lee(20260522) / kim@oblivseoul.kr(20260523) / marissong(20260527)
-- 루트 코즈 #2: VISIT-FOLD-FILTER 필터 활성 상태에서 저장 → 새 차트가 필터에 안 걸려 숨겨짐
--   → FE 별도 패치 (handleSave 후 필터 리셋)
-- 수정 범위: DB 전용 (FE는 MedicalChartPanel.tsx 별도 패치)
-- 롤백: 20260527200000_medchart_data_loss_fix.rollback.sql
-- Ticket: T-20260527-foot-MEDCHART-DATA-LOSS

-- ── 1. marissong@oblivseoul.kr clinic_id 즉시 복구 ─────────────────────────────
UPDATE user_profiles
   SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
 WHERE id    = '4d0d5d5b-e582-4ea2-8d41-17083cacd909'
   AND email = 'marissong@oblivseoul.kr'          -- 이중 안전장치
   AND clinic_id IS NULL;                         -- 이미 설정된 경우 건너뜀 (멱등)

-- ── 2. 잔여 NULL clinic_id active 사용자 전체 보정 ─────────────────────────────
-- 오블리브 풋센터는 오리진점(74967aea) 단일 운영 확인.
-- 잔여 NULL active 사용자 일괄 배정 (멱등).
UPDATE user_profiles
   SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
 WHERE clinic_id IS NULL
   AND active = true;

-- ── 3. RLS mc_clinic_isolated_v3: coordinator 포함 확장 (구조적 안전망) ─────────
-- 기존 v2: NULL-clinic bypass 대상 = admin / director / manager
-- 변경 v3: coordinator 추가
--   근거: single-clinic 환경에서 coordinator NULL은 항상 오배정 상태.
--         정상 운영에서는 1번 조건(clinic_id = current_user_clinic_id())으로 처리.
--         NULL 상태가 RLS 완전 차단이 되지 않도록 방어망 추가.
DROP POLICY IF EXISTS "mc_clinic_isolated_v2"  ON medical_charts;
DROP POLICY IF EXISTS "mc_clinic_isolated_v3"  ON medical_charts;

CREATE POLICY "mc_clinic_isolated_v3" ON medical_charts
  FOR ALL TO authenticated
  USING (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager', 'coordinator')
    )
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()::text
    OR (
      current_user_clinic_id() IS NULL
      AND current_user_role() IN ('admin', 'director', 'manager', 'coordinator')
    )
  );

-- ── 4. 검증 ────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_marissong_clinic UUID;
  v_remaining_null   INT;
  v_policy_exists    BOOLEAN;
BEGIN
  -- 4-a. marissong 보정 확인
  SELECT clinic_id INTO v_marissong_clinic
    FROM user_profiles
   WHERE id = '4d0d5d5b-e582-4ea2-8d41-17083cacd909';

  IF v_marissong_clinic IS NULL THEN
    RAISE EXCEPTION 'MEDCHART-DATA-LOSS fix 실패: marissong@oblivseoul.kr clinic_id 여전히 NULL';
  END IF;

  IF v_marissong_clinic::text <> '74967aea-a60b-4da3-a0e7-9c997a930bc8' THEN
    RAISE EXCEPTION 'MEDCHART-DATA-LOSS fix 실패: marissong clinic_id 값 불일치 (%= %)',
                    v_marissong_clinic, '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  END IF;

  -- 4-b. 잔여 NULL active 사용자 없어야 함
  SELECT COUNT(*) INTO v_remaining_null
    FROM user_profiles
   WHERE clinic_id IS NULL AND active = true;

  IF v_remaining_null > 0 THEN
    RAISE WARNING '경고: clinic_id=NULL인 active 사용자 %건 잔존. 수동 검토 필요.', v_remaining_null;
  END IF;

  -- 4-c. v3 정책 존재 확인
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'medical_charts'
       AND policyname = 'mc_clinic_isolated_v3'
  ) INTO v_policy_exists;

  IF NOT v_policy_exists THEN
    RAISE EXCEPTION 'mc_clinic_isolated_v3 정책 생성 실패';
  END IF;

  -- 4-d. 구 v2 정책 제거 확인
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'medical_charts'
       AND policyname = 'mc_clinic_isolated_v2'
  ) THEN
    RAISE EXCEPTION '구 정책 mc_clinic_isolated_v2 가 아직 남아있음';
  END IF;

  RAISE NOTICE 'MEDCHART-DATA-LOSS fix 성공: marissong clinic_id=74967aea, v3 정책 적용 완료';
END $$;

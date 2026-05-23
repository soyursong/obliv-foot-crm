-- T-20260523-foot-CHARTSAVE-REGRESS: coordinator clinic_id NULL 보정 (P0 hotfix)
--
-- 루트 코즈 (로그 기반 확인):
--   kim@oblivseoul.kr (coordinator, id=2b613328-5c4e-43d3-8b8c-649806bc1095) 의
--   user_profiles.clinic_id = NULL.
--
--   mc_clinic_isolated_v2 (전 핫픽스 825e2ca 적용) WITH CHECK:
--     clinic_id = current_user_clinic_id()::text
--     OR (current_user_clinic_id() IS NULL AND current_user_role() IN ('admin','director','manager'))
--
--   coordinator 역할은 2번째 조건 미해당 → NULL='' 비교 → NULL → RLS 차단 → 42501
--   → FE handleSave catch → toast.error('저장 실패: new row violates row-level security...')
--
-- 이전 핫픽스(825e2ca) 누락 이유:
--   T-20260522-foot-MEDCHART-SAVE-ERR 는 admin/director/manager(HQ 계정)만 커버했고,
--   coordinator 역할의 clinic_id=NULL 케이스는 미진단.
--
-- 수정 (DB 전용, FE 코드 변경 없음):
--   user_profiles.clinic_id 보정: kim@oblivseoul.kr → 풋센터 종로 오리진점 배정
--   단일 클리닉 확인 완료 (clinics 테이블에 74967aea 1건만 존재).
--
-- 롤백: 20260523030000_chartsave_regress_coordinator_clinic_fix.rollback.sql
-- Ticket: T-20260523-foot-CHARTSAVE-REGRESS

-- ── 1. kim@oblivseoul.kr clinic_id 보정 ────────────────────────────────────────

UPDATE user_profiles
   SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
 WHERE id    = '2b613328-5c4e-43d3-8b8c-649806bc1095'
   AND email = 'kim@oblivseoul.kr'           -- 이중 안전장치
   AND clinic_id IS NULL;                    -- 이미 설정된 경우 건너뜀 (멱등)

-- ── 2. 검증 ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_clinic_id UUID;
  v_remaining_null_count INT;
BEGIN
  -- 2-a. 보정 결과 확인
  SELECT clinic_id INTO v_clinic_id
    FROM user_profiles
   WHERE id = '2b613328-5c4e-43d3-8b8c-649806bc1095';

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'CHARTSAVE-REGRESS fix 실패: kim@oblivseoul.kr clinic_id 여전히 NULL';
  END IF;

  IF v_clinic_id::text <> '74967aea-a60b-4da3-a0e7-9c997a930bc8' THEN
    RAISE EXCEPTION 'CHARTSAVE-REGRESS fix 실패: clinic_id 값 불일치 (%= %)',
                    v_clinic_id, '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  END IF;

  -- 2-b. 잔여 NULL 사용자 수 경고 (RAISE NOTICE — 에러는 아님)
  SELECT COUNT(*) INTO v_remaining_null_count
    FROM user_profiles
   WHERE clinic_id IS NULL AND active = true;

  IF v_remaining_null_count > 0 THEN
    RAISE NOTICE '경고: clinic_id=NULL인 active 사용자 %건 잔존. 추가 조사 필요.', v_remaining_null_count;
  END IF;

  RAISE NOTICE 'CHARTSAVE-REGRESS fix 성공: kim@oblivseoul.kr clinic_id=74967aea 배정 완료';
END $$;

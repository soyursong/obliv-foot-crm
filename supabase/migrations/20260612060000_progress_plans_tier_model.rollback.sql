-- ============================================================
-- ROLLBACK: T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND (AC-2/3)
-- 20260612000000_progress_plans_tier_model.sql 되돌리기
-- 효과: tier 모델 제거 → 레거시 package_type(package1/blelabel/special) 10건 복원
-- 주의: forward migration 이후 UI로 추가된 tier 행이 있으면 함께 삭제됨(의도된 복귀).
-- ============================================================

BEGIN;

-- 1. 신규 제약·인덱스 제거
DROP INDEX IF EXISTS public.idx_ppp_clinic_tier_milestone;
ALTER TABLE public.package_progress_plans
  DROP CONSTRAINT IF EXISTS uq_ppp_clinic_tier_milestone;
ALTER TABLE public.package_progress_plans
  DROP CONSTRAINT IF EXISTS chk_ppp_tier_positive;

-- 2. tier 모델 행 전체 삭제 (package_type='tier_%')
DELETE FROM public.package_progress_plans
  WHERE package_type LIKE 'tier\_%';

-- 3. 레거시 시드 10건 복원 (20260526170000_progress_plans.sql 원본)
DO $$
DECLARE
  v_clinic UUID;
BEGIN
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN
    RAISE WARNING 'jongno-foot clinic not found — legacy restore skipped';
    RETURN;
  END IF;

  INSERT INTO public.package_progress_plans
    (clinic_id, package_type, session_milestone, label, notify_staff, notify_patient, is_active)
  VALUES
    (v_clinic, 'package1',  6,  '6회 중간 경과분석',  TRUE, FALSE, TRUE),
    (v_clinic, 'package1', 12,  '12회 최종 경과분석', TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel',  6,  '6회 경과분석',       TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 12,  '12회 중간 경과분석', TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 18,  '18회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 24,  '24회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 30,  '30회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 36,  '36회 최종 경과분석', TRUE, FALSE, TRUE),
    (v_clinic, 'special',   6,  '6회 중간 경과분석',  TRUE, FALSE, TRUE),
    (v_clinic, 'special',  12,  '12회 최종 경과분석', TRUE, FALSE, TRUE)
  ON CONFLICT (clinic_id, package_type, session_milestone) DO NOTHING;
END $$;

-- 4. 신규 컬럼 제거
ALTER TABLE public.package_progress_plans
  DROP COLUMN IF EXISTS session_count_tier;

COMMIT;

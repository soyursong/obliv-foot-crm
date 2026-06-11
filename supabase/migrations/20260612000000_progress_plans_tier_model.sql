-- ============================================================
-- T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND (AC-2/3)
-- 경과분석 플랜 데이터모델 재설계: package_type string → total_sessions tier 기준
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-12
-- 선행: 20260526170000_progress_plans.sql (package_progress_plans 존재)
-- 롤백: 20260612000000_progress_plans_tier_model.rollback.sql
-- 근거: 김주연 총괄 confirm (Option C) + dry-run (scripts/..._dryrun.mjs)
--   - tier = 6의 배수 전체: 6/12/18/24/30/36/42/48
--   - 레거시 이관: package1→tier_12, blelabel→tier_36, special→폐기
--   - 매칭키: (clinic_id, session_count_tier, session_milestone) — packages.total_sessions와 join
-- risk: GO_WARN (스키마 변경 + 데이터 이관 + 시드). dry-run 검증 완료. 롤백 SQL 동봉.
-- 영향: BEFORE flagged=0 → AFTER eligible 모집단 416 active pkg (건별 발동, 일괄발동 없음)
-- ============================================================

BEGIN;

-- ── 1. 신규 컬럼: session_count_tier (매칭키) ────────────────────────────────
ALTER TABLE public.package_progress_plans
  ADD COLUMN IF NOT EXISTS session_count_tier INTEGER;

COMMENT ON COLUMN public.package_progress_plans.session_count_tier IS
  'T-PROGRESSPLAN-PKGTYPE: 경과분석 tier = packages.total_sessions(6의배수). 매칭키. package_type(=tier_N)는 호환용 표기.';

-- ── 2. 레거시 10건 이관 (confirm 확정 매핑) ─────────────────────────────────
-- package1(milestone 6,12) → tier_12
UPDATE public.package_progress_plans
  SET session_count_tier = 12, package_type = 'tier_12', updated_at = now()
  WHERE package_type = 'package1';

-- blelabel(milestone 6..36) → tier_36
UPDATE public.package_progress_plans
  SET session_count_tier = 36, package_type = 'tier_36', updated_at = now()
  WHERE package_type = 'blelabel';

-- special(실사용 0 패키지) → 폐기(드랍)
DELETE FROM public.package_progress_plans
  WHERE package_type = 'special';

-- ── 3. 6의 배수 tier 전체 시드 (6/12/18/24/30/36/42/48) ──────────────────────
-- milestone = 6의 배수, tier까지. milestone==tier → "최종", 그 외 "중간".
-- 이관된 tier_12·tier_36는 ON CONFLICT DO NOTHING으로 중복 회피(보존).
-- ⚠ 24/48 = 신규 플랜 아님, 6의배수 tier 패턴에 자동 포함 (별도 row 개념 아님).
DO $$
DECLARE
  v_clinic UUID;
BEGIN
  FOR v_clinic IN SELECT DISTINCT clinic_id FROM public.package_progress_plans LOOP
    INSERT INTO public.package_progress_plans
      (clinic_id, package_type, session_milestone, label, session_count_tier, notify_staff, notify_patient, is_active)
    SELECT
      v_clinic,
      'tier_' || t.tier,
      m.ms,
      CASE WHEN m.ms = t.tier THEN m.ms || '회 최종 경과분석' ELSE m.ms || '회 중간 경과분석' END,
      t.tier,
      TRUE, FALSE, TRUE
    FROM (VALUES (6),(12),(18),(24),(30),(36),(42),(48)) AS t(tier)
    CROSS JOIN LATERAL generate_series(6, t.tier, 6) AS m(ms)
    ON CONFLICT (clinic_id, package_type, session_milestone) DO NOTHING;
  END LOOP;
END $$;

-- ── 4. 무결성: tier NOT NULL + CHECK + 신규 매칭 unique + 인덱스 ──────────────
-- 모든 행이 이관/시드로 tier 보유 → NOT NULL 안전.
ALTER TABLE public.package_progress_plans
  ALTER COLUMN session_count_tier SET NOT NULL;

ALTER TABLE public.package_progress_plans
  DROP CONSTRAINT IF EXISTS chk_ppp_tier_positive;
ALTER TABLE public.package_progress_plans
  ADD CONSTRAINT chk_ppp_tier_positive CHECK (session_count_tier > 0);

-- 신규 매칭키 unique (tier 기준)
ALTER TABLE public.package_progress_plans
  DROP CONSTRAINT IF EXISTS uq_ppp_clinic_tier_milestone;
ALTER TABLE public.package_progress_plans
  ADD CONSTRAINT uq_ppp_clinic_tier_milestone UNIQUE (clinic_id, session_count_tier, session_milestone);

CREATE INDEX IF NOT EXISTS idx_ppp_clinic_tier_milestone
  ON public.package_progress_plans(clinic_id, session_count_tier, session_milestone)
  WHERE is_active = TRUE;

COMMIT;

-- 검증 (apply 후 수동 확인용):
-- SELECT session_count_tier, count(*), array_agg(session_milestone ORDER BY session_milestone)
--   FROM package_progress_plans GROUP BY session_count_tier ORDER BY session_count_tier;
-- 기대: 6→[6], 12→[6,12], 18→[6,12,18], 24→[..24], 30→[..30], 36→[..36], 42→[..42], 48→[..48]

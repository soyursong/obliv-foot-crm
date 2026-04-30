-- KICK-20260430-171500-FOOT-STAFF-EDIT-TRIGGER
-- P0 핫픽스: set_updated_at 트리거가 있으나 updated_at 컬럼이 없는 테이블 일괄 수정
--
-- 분석 결과 (2026-04-30 live DB 확인):
--   staff            → trg_updated_at 있음 + updated_at 컬럼 없음 → 직원 수정 시 에러 발생
--   consent_templates→ trg_updated_at 있음 + updated_at 컬럼 없음 → 잠재 에러
--   daily_closings   → trg_updated_at 있음 + updated_at 컬럼 없음 → 잠재 에러
--   user_profiles    → 트리거 없음 + 컬럼 없음  → KICK 지시대로 추가

-- ───────────────────────────────────────────────────
-- 1) staff: updated_at 컬럼 추가 (즉시 운영 에러 해결)
-- ───────────────────────────────────────────────────
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.staff
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- ───────────────────────────────────────────────────
-- 2) consent_templates: updated_at 컬럼 추가
-- ───────────────────────────────────────────────────
ALTER TABLE public.consent_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.consent_templates
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- ───────────────────────────────────────────────────
-- 3) daily_closings: updated_at 컬럼 추가 (created_at 없음 → closed_at 사용)
-- ───────────────────────────────────────────────────
ALTER TABLE public.daily_closings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.daily_closings
  SET updated_at = COALESCE(closed_at, now())
  WHERE updated_at IS NULL;

-- ───────────────────────────────────────────────────
-- 4) user_profiles: updated_at 컬럼 + 트리거 추가 (KICK 지시)
-- ───────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.user_profiles
  SET updated_at = created_at
  WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_updated_at ON public.user_profiles;
CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

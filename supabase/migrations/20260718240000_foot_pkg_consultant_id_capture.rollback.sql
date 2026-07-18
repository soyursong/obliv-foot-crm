-- ROLLBACK — T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE (Phase 1)
--   컬럼·트리거·함수·인덱스 전량 제거. 데이터 순소실 0 (원장은 package_payments·check_ins 에 존재).
--   foot_stats_consultant 는 이 컬럼 미참조(heuristic 유지) → 롤백 후 stats 무영향.
-- author: dev-foot / 2026-07-18

BEGIN;

DROP TRIGGER IF EXISTS trg_pkg_consultant_capture ON public.packages;
DROP FUNCTION IF EXISTS public.set_package_consultant_id();
DROP INDEX IF EXISTS public.idx_packages_consultant_id;
ALTER TABLE public.packages DROP COLUMN IF EXISTS consultant_id;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- ROLLBACK: T-20260512-foot-TREATMENT-SET
-- 실행 순서: treatment_set_items → treatment_sets (CASCADE로 자동)
-- ============================================================

BEGIN;

-- 시드 데이터 포함 전체 삭제 (CASCADE — set_items 자동 삭제)
DROP TABLE IF EXISTS public.treatment_set_items;
DROP TABLE IF EXISTS public.treatment_sets;

-- 트리거 함수는 다른 테이블에서도 사용 중일 수 있으므로 유지
-- (set_updated_at 함수는 범용이므로 삭제 안 함)

COMMIT;

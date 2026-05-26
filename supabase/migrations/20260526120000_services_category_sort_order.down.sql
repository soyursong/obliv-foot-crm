-- T-20260526-foot-SVC-CATEGORY-SORT rollback
-- sort_order 재정규화 → 직접 되돌리기 불가 (데이터 변경)
-- 인덱스만 제거, 데이터는 보존 (기존 순서로 재복원 불필요)

DROP INDEX IF EXISTS idx_services_clinic_catlabel_sort;

COMMENT ON COLUMN services.sort_order IS NULL;

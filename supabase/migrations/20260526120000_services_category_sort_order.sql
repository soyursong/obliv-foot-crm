-- T-20260526-foot-SVC-CATEGORY-SORT AC-2, AC-4, AC-5
-- 서비스관리 탭별 독립 순서 정렬 기반 구축
--
-- 목적:
--   1. sort_order를 (clinic_id, category_label) 단위로 재정규화
--      → 탭 내 sort_order 값이 0, 10, 20, 30... 으로 명확히 정렬됨
--   2. 조회 최적화 인덱스 추가
--
-- risk: DB 스키마 변경 1/5 (GO_WARN)
-- rollback: 20260526120000_services_category_sort_order.down.sql

-- 1. sort_order 컬럼 COMMENT 업데이트
COMMENT ON COLUMN services.sort_order IS
  'T-20260526-foot-SVC-CATEGORY-SORT: 서비스관리 탭 내 표시 순서. '
  '(clinic_id, category_label) 단위로 독립 관리. '
  '드래그앤드롭/↑↓ 버튼으로 변경 후 DB 저장. '
  '값: 0, 10, 20, 30... (10 단위)';

-- 2. sort_order를 (clinic_id, category_label) 단위로 재정규화
--    기존 상대 순서 유지(sort_order ASC, name ASC 기준), 10 단위 간격으로 정리
WITH ranked AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      PARTITION BY clinic_id, COALESCE(category_label, '')
      ORDER BY sort_order ASC, name ASC
    ) - 1) * 10 AS new_order
  FROM services
)
UPDATE services s
SET sort_order = r.new_order
FROM ranked r
WHERE s.id = r.id;

-- 3. 조회 최적화 인덱스 추가 (탭별 sort_order 조회)
CREATE INDEX IF NOT EXISTS idx_services_clinic_catlabel_sort
  ON services(clinic_id, category_label, sort_order);

-- T-20260525-foot-FEE-ITEM-REORDER AC-6
-- services 테이블에 display_order 컬럼 추가 (clinic 단위 수가 항목 표시 순서 persist)
--
-- 목적: 결제 미니창 수가 항목 순서를 지점(clinic) 단위로 저장/복원
--       재진입 시 저장된 순서 복원 (AC-2)
--
-- risk: DB 스키마 변경 1/5 (GO_WARN)
-- rollback: 20260525070000_services_display_order.down.sql

ALTER TABLE services ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

-- 기존 서비스의 display_order를 sort_order 기준으로 초기화
-- (clinic 단위 상대 순서 유지)
UPDATE services
SET display_order = sort_order
WHERE display_order = 0;

-- sort_order가 모두 0이거나 중복인 경우 row_number로 재초기화
-- (clinic_id × created_at 기준 순번)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id
      ORDER BY sort_order, created_at
    ) - 1 AS rn
  FROM services
  WHERE display_order = 0
)
UPDATE services s
SET display_order = r.rn
FROM ranked r
WHERE s.id = r.id;

-- 인덱스: clinic 단위 display_order 조회 최적화
CREATE INDEX IF NOT EXISTS idx_services_clinic_display_order
  ON services(clinic_id, display_order);

COMMENT ON COLUMN services.display_order IS
  'T-20260525-foot-FEE-ITEM-REORDER AC-6: clinic 단위 결제 미니창 수가 항목 표시 순서. 드래그앤드롭/버튼 재배열 시 업데이트.';

-- T-20260522-foot-DESIGNATED-THERAPIST
-- 지정 치료사 FK — customers.designated_therapist_id → staff(id)
-- 승인: 김주연 총괄 구두 승인 (2026-05-22)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS designated_therapist_id UUID
    REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_designated_therapist
  ON customers(designated_therapist_id)
  WHERE designated_therapist_id IS NOT NULL;

COMMENT ON COLUMN customers.designated_therapist_id
  IS '지정 치료사 FK — staff(id). 재진 예약 회차 차감 시 자동 선택, 수동 변경 가능.';

-- C23-DETAIL-SIMPLIFY: 치료메모 (치료사끼리 해당 고객 특이사항 기입)
-- 기존 consultation_notes 테이블 불필요 — customers 테이블에 단순 텍스트 필드로 추가

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS treatment_note TEXT;

COMMENT ON COLUMN customers.treatment_note IS '치료메모: 치료사끼리 공유하는 고객 특이사항 메모 (C23-DETAIL-SIMPLIFY)';

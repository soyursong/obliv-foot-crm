-- T-20260526-foot-VISIT-HIST-FILTER
-- customer_treatment_memos 에 메모유형(memo_type) 컬럼 추가
-- 값: 치료메모 | 진료메모 | 특이사항   (기본값: 치료메모)
-- 롤백: 20260526160000_ctm_memo_type.rollback.sql

ALTER TABLE customer_treatment_memos
  ADD COLUMN IF NOT EXISTS memo_type text NOT NULL DEFAULT '치료메모'
    CONSTRAINT ctm_memo_type_check CHECK (memo_type IN ('치료메모', '진료메모', '특이사항'));

COMMENT ON COLUMN customer_treatment_memos.memo_type IS
  '메모 유형: 치료메모(기본) | 진료메모 | 특이사항 (T-20260526-foot-VISIT-HIST-FILTER)';

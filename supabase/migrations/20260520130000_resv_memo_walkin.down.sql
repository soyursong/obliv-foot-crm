-- T-20260520-foot-RESV-MEMO-WALKIN rollback
-- 워크인 메모 fallback 스키마 변경 롤백

-- 4. CHECK 제약 제거
ALTER TABLE reservation_memo_history
  DROP CONSTRAINT IF EXISTS chk_rmh_id_present;

-- 3. customer_id 인덱스 제거
DROP INDEX IF EXISTS idx_rmh_customer_id;

-- 2. customer_id 컬럼 제거 (customer_id 기반 데이터 손실 주의)
ALTER TABLE reservation_memo_history
  DROP COLUMN IF EXISTS customer_id;

-- 1. reservation_id NOT NULL 복원
--    주의: 기존 데이터 중 reservation_id=NULL 행이 있으면 실패
--    → 롤백 전 NULL 행 정리 필요
ALTER TABLE reservation_memo_history
  ALTER COLUMN reservation_id SET NOT NULL;

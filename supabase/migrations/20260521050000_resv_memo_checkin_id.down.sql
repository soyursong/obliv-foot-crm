-- T-20260521-foot-WALKIN-MEMO-GAP rollback
-- check_in_id fallback 컬럼 제거

-- 3. CHECK 제약 갱신 (check_in_id 제거 전 복원)
ALTER TABLE reservation_memo_history
  DROP CONSTRAINT IF EXISTS chk_rmh_id_present;

ALTER TABLE reservation_memo_history
  ADD CONSTRAINT chk_rmh_id_present
  CHECK (reservation_id IS NOT NULL OR customer_id IS NOT NULL);

-- 2. check_in_id 인덱스 제거
DROP INDEX IF EXISTS idx_rmh_check_in_id;

-- 1. check_in_id 컬럼 제거 (check_in_id 기반 데이터 손실 주의)
ALTER TABLE reservation_memo_history
  DROP COLUMN IF EXISTS check_in_id;

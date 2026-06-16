-- Rollback: 20260617000000_blood_test_requested.sql
-- T-20260615-foot-BLOODTEST-TOGGLE-ADD
-- ADDITIVE 역연산만(파괴요소 0). blood_test_requested 는 foot-internal 운영 플래그 → 손실 가능 데이터 없음.

BEGIN;

-- RPC 제거
DROP FUNCTION IF EXISTS set_blood_test_requested(uuid, boolean);

-- blood_test_requested 컬럼 제거(ADDITIVE 역연산)
ALTER TABLE check_in_services DROP COLUMN IF EXISTS blood_test_requested;

COMMIT;

-- Rollback: T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE
-- soft-void forward 프리미티브 3컬럼 제거(DROP COLUMN IF EXISTS × 3).
--   forward-only 컬럼(배포 직후 전건 NULL) → 데이터 손실 0.
--   ⚠ 롤백 전 반드시 FE/집계의 `WHERE voided_at IS NULL` 필터 코드도 동시 롤백할 것
--     (컬럼 제거 후 필터 쿼리 실행 시 PostgREST "column does not exist" 오류).
BEGIN;

ALTER TABLE closing_manual_payments DROP COLUMN IF EXISTS voided_at;
ALTER TABLE closing_manual_payments DROP COLUMN IF EXISTS voided_reason;
ALTER TABLE closing_manual_payments DROP COLUMN IF EXISTS voided_by;

COMMIT;

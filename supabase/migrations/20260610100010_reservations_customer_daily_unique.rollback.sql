-- ROLLBACK: T-20260610-foot-RESV-DUPGUARD-SAMEDAY — reservations customer daily unique index 제거
-- 인덱스 제거 후에도 FE/RPC 가드는 계속 동작(1차 방어 유지). 최종 동시성 방어만 해제.
BEGIN;
DROP INDEX IF EXISTS idx_reservations_customer_daily;
COMMIT;

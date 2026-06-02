-- ROLLBACK: T-20260602-foot-SELFCHECKIN-DUP-GUARD — walkin daily unique index 제거
-- 인덱스 제거 후에도 FE/RPC 가드는 계속 동작(1차 방어 유지). 최종 동시성 방어만 해제.
BEGIN;
DROP INDEX IF EXISTS idx_checkins_walkin_daily;
COMMIT;

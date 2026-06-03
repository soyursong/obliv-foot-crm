-- Rollback: T-20260603-foot-DASH-NAME-STALE-SYNC 성함 동기화 트리거 제거
-- 트리거/함수만 제거. backfill 로 정정된 스냅샷 데이터는 되돌리지 않음(정상값).

BEGIN;

DROP TRIGGER IF EXISTS trg_sync_customer_name ON public.customers;
DROP FUNCTION IF EXISTS fn_sync_customer_name();

COMMIT;

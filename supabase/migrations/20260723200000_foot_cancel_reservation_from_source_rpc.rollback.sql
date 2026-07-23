-- ROLLBACK: T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC
--   20260723200000_foot_cancel_reservation_from_source_rpc.sql 역적용.
--   ADDITIVE(신규 callable) 이므로 rollback = 함수 DROP(기존 오브젝트·데이터 무영향).
BEGIN;

DROP FUNCTION IF EXISTS public.cancel_reservation_from_source(TEXT, TEXT, TEXT);

COMMIT;

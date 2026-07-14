-- ROLLBACK — T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE
--   트리거 + 트리거 함수 DROP. helper `_fn_is_masked_pii` 는 RESCOPE/CLOSE-R2 가드가 공유하므로 보존.
--   ADDITIVE 역연산(순소실 0): 트리거 제거 = customers write 는 per-RPC 가드(defense-in-depth)로 회귀.
-- author: dev-foot / 2026-07-15
BEGIN;

DROP TRIGGER IF EXISTS trg_customers_reject_masked_pii ON public.customers;
DROP FUNCTION IF EXISTS public._trg_customers_reject_masked_pii();

COMMIT;

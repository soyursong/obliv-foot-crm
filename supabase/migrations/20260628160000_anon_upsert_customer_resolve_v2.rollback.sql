-- ROLLBACK: T-20260627-foot-ANON-RLS-PHASE2B Gate B — _resolve_v2 제거.
-- 실 롤백 1순위 = FE repoint(신규 RPC 호출 → 구 fn_selfcheckin_upsert_customer 직접 SELECT/INSERT 경로),
--   무중단. 구 함수 잔존이므로 본 DROP 은 FE 컷오버 되돌림 완료 후에만 적용(미적용 시 FE 42883/PGRST202).
BEGIN;

REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_upsert_customer_resolve_v2(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
);

COMMIT;

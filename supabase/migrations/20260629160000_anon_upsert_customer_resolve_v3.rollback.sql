-- ROLLBACK: T-20260627-foot-ANON-RLS-PHASE2B Gate B(우산) — _resolve_v3 제거.
-- 실 롤백 1순위 = FE repoint(_resolve_v3 호출 → 구 _resolve_v2 또는 fn_selfcheckin_upsert_customer 경로),
--   무중단. 구 _resolve_v2 잔존이므로 본 DROP 은 FE 가 v3 를 호출하지 않을 때에만 적용
--   (미적용 시 FE 42883/PGRST202). ADDITIVE 함수 1종만 제거 — 데이터·컬럼 무변경.
-- 주의: consent_sensitive 3컬럼은 본 마이그가 만든 것이 아님(20260629120000 소유) → 여기서 DROP 금지.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
) FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_upsert_customer_resolve_v3(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
);

COMMIT;

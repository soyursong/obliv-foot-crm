-- T-20260516-foot-C21-SAVE-REGRESS: address 저장 regression 영구 수정
--
-- 목적: PostgREST 스키마 캐시 stale → address UPDATE 실패 방지
-- 방법: 1) NOTIFY pgrst (즉시 캐시 갱신)
--       2) save_customer_address RPC 함수 생성 (스키마 캐시 우회)
--
-- 스키마 캐시 이슈 설명:
--   - address / address_detail 컬럼 추가 후 PostgREST 캐시 갱신 누락 시
--     PostgREST REST API UPDATE가 PGRST116 "could not find column" 오류 반환
--   - RPC 함수는 SQL 직접 실행 → 캐시 우회 → 항상 정상 동작
--
-- 롤백: 20260517000070_save_customer_address_fn.down.sql

-- Step 1: 스키마 캐시 즉시 리프레시
NOTIFY pgrst, 'reload schema';

-- Step 2: address 저장 전용 RPC 함수 (스키마 캐시 우회)
-- FE: supabase.rpc('save_customer_address', { p_customer_id, p_address, p_address_detail, p_postal_code })
CREATE OR REPLACE FUNCTION public.save_customer_address(
  p_customer_id  UUID,
  p_address      TEXT,
  p_address_detail TEXT,
  p_postal_code  TEXT
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE customers
  SET
    address        = p_address,
    address_detail = p_address_detail,
    postal_code    = p_postal_code
  WHERE id = p_customer_id;
$$;

COMMENT ON FUNCTION public.save_customer_address IS
  'T-20260516-foot-C21-SAVE-REGRESS: address/address_detail/postal_code 3필드 단일 저장.'
  ' PostgREST 스키마 캐시 stale 시 REST UPDATE 실패하는 regression 우회용.'
  ' SECURITY INVOKER → 호출자 RLS 그대로 적용.';

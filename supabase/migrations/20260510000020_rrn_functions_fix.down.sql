-- Rollback: T-20260510-foot-C21-SSN-INPUT rrn 함수 롤백
-- 주의: 이전 함수 정의를 알 수 없으므로 함수를 DROP하고 stub으로 교체
BEGIN;

-- stub 함수 (호출 시 에러 반환, 기능 비활성화)
CREATE OR REPLACE FUNCTION public.rrn_encrypt(customer_uuid UUID, plain_rrn TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'rrn_encrypt: rolled back';
END;
$$;

CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN NULL;
END;
$$;

COMMIT;

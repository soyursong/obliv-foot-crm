-- T-20260511-foot-SSN-SAVE-BUG: 롤백 (이전 버전으로 복구)
-- 이전 버전은 search_path=public 에서 pgp_sym_encrypt를 직접 참조했으나
-- pgcrypto가 extensions 스키마에 있어 동작 불가. 롤백 시 저장 기능 다시 망가짐.
-- 롤백 대신 문제 원인 파악 후 rrn_functions_fix 파일 다시 적용 권장.

BEGIN;

-- 기능 비활성화만: 함수를 빈 본문으로 대체 (데이터 보존)
CREATE OR REPLACE FUNCTION public.rrn_encrypt(
  customer_uuid UUID,
  plain_rrn     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'rrn_encrypt 비활성화됨 (rollback)';
END;
$$;

CREATE OR REPLACE FUNCTION public.rrn_decrypt(
  customer_uuid UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NULL;
END;
$$;

COMMIT;

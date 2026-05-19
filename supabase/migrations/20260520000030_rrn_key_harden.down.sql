-- Rollback: 20260520000030_rrn_key_harden.sql
-- 하드코딩 폴백이 있던 이전 버전(20260511000010)으로 되돌림

BEGIN;

-- rrn_encrypt 폴백 복원
CREATE OR REPLACE FUNCTION public.rrn_encrypt(
  customer_uuid UUID,
  plain_rrn     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key TEXT;
BEGIN
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;
  UPDATE public.customers
    SET rrn_enc = extensions.pgp_sym_encrypt(plain_rrn, v_key)
  WHERE id = customer_uuid;
END;
$$;

-- rrn_decrypt 폴백 복원
CREATE OR REPLACE FUNCTION public.rrn_decrypt(
  customer_uuid UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_enc   BYTEA;
  v_key   TEXT;
  v_plain TEXT;
BEGIN
  SELECT rrn_enc INTO v_enc
    FROM public.customers
   WHERE id = customer_uuid;
  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;
  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);
  RETURN v_plain;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rrn_decrypt(UUID) TO authenticated;

-- nhis_idor_audit_logs 제거
DROP TABLE IF EXISTS public.nhis_idor_audit_logs;

COMMIT;

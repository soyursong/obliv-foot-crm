-- ============================================================================
-- T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL · ROLLBACK
--   tenant/role seal 해제 → 20260520000030_rrn_key_harden.sql 의 rrn_encrypt
--   원형(키-게이트 O·tenant/role assert 무)으로 원복(취약 재노출).
--   완전가역: CREATE OR REPLACE 로 seal-이전 body 복원. decrypt/GRANT 무접촉.
--   ⚠ 롤백 = cross-tenant write 취약 복원이므로 supervisor 판단 하에만 실행.
-- ============================================================================
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
    RAISE EXCEPTION 'app.rrn_key not configured — RRN encryption unavailable'
      USING ERRCODE = 'P0002',
            HINT    = 'Run: ALTER DATABASE postgres SET app.rrn_key = ''<your-secret-key-min-32-chars>'';';
  END IF;

  UPDATE public.customers
    SET rrn_enc = extensions.pgp_sym_encrypt(plain_rrn, v_key)
  WHERE id = customer_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.rrn_encrypt(UUID, TEXT) IS
  'rrn_encrypt — RRN pgp_sym_encrypt write (T-20260520-foot-NHIS-HARDEN 원형·tenant/role seal 해제됨).';

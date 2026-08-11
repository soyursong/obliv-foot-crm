-- ============================================================================
-- T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL · ROLLBACK  (REWRITTEN 2026-08-11)
--   tenant/role seal 해제 → prod 실재 **Vault-V2 pre-seal body** 원복.
--   ⚠ 초판(v1)은 GUC(app.rrn_key) body 로 원복 → prod 실재(Vault-V2) 미복원 = 가역성
--     깨짐(FIX-REQUEST MSG-20260811-151014-419f #3). 본 rollback 은 prod 정본
--     (Vault-V2·foot_rrn_key_v2·resident_id NULL scrub·rrn_re_encrypted_at·version=2)로 원복.
--   provenance = agents/docs/_draft/sql/rrn_stage2_foot_dual_key_functions.sql
--                (STAGE2 dual-key, commit 4f502d6) 의 rrn_encrypt body verbatim.
--   재현 대상 = prod def md5(pg_get_functiondef) 0385d316f5c8d336824ce211ce35281b.
--   완전가역: CREATE OR REPLACE 로 seal-이전 Vault-V2 body 복원. decrypt/GRANT 무접촉.
--   ⚠ 롤백 = cross-tenant write 취약 복원이므로 supervisor 판단 하에만 실행.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rrn_encrypt(customer_uuid UUID, plain_rrn TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_new_key TEXT;
BEGIN
  -- 신키 조회 (Vault 단일 경로 — GUC fallback 완전 제거)
  SELECT decrypted_secret INTO v_new_key
    FROM vault.decrypted_secrets
   WHERE name = 'foot_rrn_key_v2';

  IF v_new_key IS NULL OR v_new_key = '' THEN
    RAISE EXCEPTION 'rrn_encrypt: 신키 미설정 (vault foot_rrn_key_v2)';
  END IF;

  UPDATE public.customers
    SET rrn_enc                = extensions.pgp_sym_encrypt(plain_rrn, v_new_key),
        resident_id            = NULL,        -- 평문 잔존 차단 (foot 컬럼 존재)
        rrn_re_encrypted_at    = NOW(),
        rrn_encryption_version = 2
    WHERE id = customer_uuid;
END;
$$;

COMMENT ON FUNCTION public.rrn_encrypt(UUID, TEXT) IS
  '[foot] RRN 신규 암호화 (신키 only, foot_rrn_key_v2). resident_id 평문 NULL 보강 + v2 보장.';

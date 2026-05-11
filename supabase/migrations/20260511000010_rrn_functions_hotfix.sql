-- T-20260511-foot-SSN-SAVE-BUG: rrn_encrypt/rrn_decrypt 핫픽스
-- 문제: 20260510000020_rrn_functions_fix.sql이 DB에 미적용 상태였음
--       현재 함수 search_path=public만 설정 → extensions.pgp_sym_encrypt 미발견
-- 수정: extensions.pgp_sym_encrypt / pgp_sym_decrypt 명시적 스키마 참조로 교체
-- 적용: 2026-05-11 직접 supabase db query 로 적용 완료
-- 롤백: 20260511000010_rrn_functions_hotfix.down.sql

BEGIN;

-- pgcrypto: extensions 스키마에 설치 확인 (Supabase 기본값)
-- CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions; -- 이미 존재하면 SKIP

-- ─────────────────────────────────────────────────────────────────
-- rrn_encrypt: 주민번호 암호화 저장
-- extensions.pgp_sym_encrypt 명시적 스키마 참조 (search_path 의존 제거)
-- ─────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────
-- rrn_decrypt: 주민번호 복호화 반환
-- extensions.pgp_sym_decrypt 명시적 스키마 참조 (search_path 의존 제거)
-- ─────────────────────────────────────────────────────────────────
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

COMMIT;

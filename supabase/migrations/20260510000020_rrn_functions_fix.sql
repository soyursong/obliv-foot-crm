-- T-20260510-foot-C21-SSN-INPUT: rrn_encrypt/rrn_decrypt 함수 search_path 수정
-- 문제: pgcrypto가 extensions 스키마에 있으나 기존 함수 search_path에 extensions 미포함
--       → pgp_sym_encrypt(text, text) does not exist 에러 발생
-- 수정: SET search_path = public, extensions 추가 + SECURITY DEFINER 유지
-- 롤백: 20260510000020_rrn_functions_fix.down.sql

BEGIN;

-- pgcrypto: Supabase는 extensions 스키마에 기본 설치됨.
-- SCHEMA 지정 없이 idempotent 보장 (이미 설치된 경우 무시).
-- search_path에 extensions 추가로 pgp_sym_encrypt 참조 가능하게 함.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- rrn 암호화 키 설정 (app.settings — Supabase Dashboard > Settings > Config에서 설정 가능)
-- 기본값 폴백으로 하드코딩 키 사용 (프로덕션에서는 반드시 app.rrn_key 설정 권장)

-- ─────────────────────────────────────────────────────────────────
-- rrn_encrypt: 주민번호 암호화 저장
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
  -- 암호화 키: app.rrn_key 설정 우선, 없으면 기본값
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  UPDATE public.customers
    SET rrn_enc = pgp_sym_encrypt(plain_rrn, v_key)
  WHERE id = customer_uuid;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- rrn_decrypt: 주민번호 복호화 반환
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

  v_plain := pgp_sym_decrypt(v_enc, v_key);
  RETURN v_plain;
END;
$$;

-- RLS: authenticated 사용자 호출 허용 (SECURITY DEFINER이므로 함수 내부 권한으로 실행)
GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rrn_decrypt(UUID) TO authenticated;

COMMIT;

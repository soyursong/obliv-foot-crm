-- T-20260520-foot-NHIS-HARDEN — Phase b · AC-1
-- rrn_encrypt / rrn_decrypt 하드코딩 폴백 제거
--   · 기존: app.rrn_key 미설정 시 'obliv_foot_rrn_key_2026' 폴백 사용
--   · 변경: 미설정 시 RAISE EXCEPTION → 암호화/복호화 불가 명시
-- 함께 생성: nhis_idor_audit_logs 테이블 (AC-3 IDOR 감사 로그)
-- 롤백: 20260520000030_rrn_key_harden.down.sql
-- 적용: supabase db push (dev) / Supabase Dashboard SQL 실행 (prod)

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- AC-1: rrn_encrypt — 하드코딩 폴백 제거
--       app.rrn_key 미설정 → RAISE EXCEPTION (P0002)
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
  -- AC-1: 하드코딩 폴백 없음 — app.rrn_key 반드시 설정 필요
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

-- ─────────────────────────────────────────────────────────────────
-- AC-1: rrn_decrypt — 하드코딩 폴백 제거
--       app.rrn_key 미설정 → RAISE EXCEPTION (P0002)
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

  -- AC-1: 하드코딩 폴백 없음 — app.rrn_key 반드시 설정 필요
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'app.rrn_key not configured — RRN decryption unavailable'
      USING ERRCODE = 'P0002',
            HINT    = 'Run: ALTER DATABASE postgres SET app.rrn_key = ''<your-secret-key-min-32-chars>'';';
  END IF;

  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);
  RETURN v_plain;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rrn_decrypt(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- AC-3: nhis_idor_audit_logs — IDOR 시도 감사 로그
--       호출자 clinic ↔ customer clinic 불일치 기록용
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nhis_idor_audit_logs (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type          TEXT        NOT NULL DEFAULT 'IDOR_ATTEMPT',
  user_id             UUID        NOT NULL,
  customer_id         UUID        NOT NULL,
  caller_clinic_id    UUID,
  customer_clinic_id  UUID,
  ip_address          TEXT,
  detail              TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.nhis_idor_audit_logs IS
  'NHIS 자격조회 IDOR 시도 감사 로그 — T-20260520-foot-NHIS-HARDEN AC-3';

-- service_role 전용 (Edge Function이 service role key로 INSERT)
ALTER TABLE public.nhis_idor_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nhis_idor_audit_service_role_only"
  ON public.nhis_idor_audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 감사 로그 인덱스: 시간순 조회
CREATE INDEX IF NOT EXISTS idx_nhis_idor_audit_created_at
  ON public.nhis_idor_audit_logs (created_at DESC);

COMMIT;

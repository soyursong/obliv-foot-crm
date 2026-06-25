-- T-20260625-foot-FOREIGN-HEALTHQ-EN
-- 외국인 전용 설문지(영문) — health_q_tokens.lang 영속화 (ADDITIVE)
--
-- DA CONSULT-REPLY(MSG-20260625-142740-supp) GO+ADDITIVE:
--   Q1 → health_q_tokens.lang TEXT NOT NULL DEFAULT 'ko' (ADDITIVE 1컬럼, 백필 불요)
--   Q2 → form_data JSONB 기존 키 재사용 (DDL 0)
--
-- 변경:
--   1) health_q_tokens.lang 컬럼 추가 (DEFAULT 'ko' — 기존 row 자동 'ko')
--   2) fn_health_q_validate_token → 반환 객체에 lang 추가
--   3) fn_health_q_create_token → p_lang 파라미터 추가 (DEFAULT 'ko'), lang 적재
--      ※ 시그니처 변경(파라미터 추가)이므로 기존 5-arg 함수 DROP 후 6-arg 재생성.
--        FE는 named-param 호출이므로 p_lang 생략 시 DEFAULT 'ko'로 매칭됨(후방호환).
--
-- 롤백: 20260625120000_health_q_lang.rollback.sql
--
-- 적용 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260625120000_health_q_lang.sql

-- ─── 1. health_q_tokens.lang (ADDITIVE) ──────────────────────────────────────
ALTER TABLE health_q_tokens
  ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ko'
    CHECK (lang IN ('ko', 'en'));

COMMENT ON COLUMN health_q_tokens.lang IS
  'T-20260625-foot-FOREIGN-HEALTHQ-EN: 설문지 표시 언어. ko(기본)|en(외국인 전용 영문).
   외국인 셀프접수 흐름에서 en 토큰 발급 → HealthQMobilePage 영문 분기 렌더.';

-- ─── 2. fn_health_q_validate_token (lang 반환 추가) ──────────────────────────
CREATE OR REPLACE FUNCTION fn_health_q_validate_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok   health_q_tokens%ROWTYPE;
  v_name  TEXT;
BEGIN
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_used');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  SELECT name INTO v_name
  FROM   customers
  WHERE  id = v_tok.customer_id;

  RETURN jsonb_build_object(
    'success',       true,
    'token_id',      v_tok.id,
    'customer_id',   v_tok.customer_id,
    'customer_name', COALESCE(v_name, ''),
    'clinic_id',     v_tok.clinic_id,
    'check_in_id',   v_tok.check_in_id,
    'form_type',     v_tok.form_type,
    'lang',          COALESCE(v_tok.lang, 'ko')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_validate_token(TEXT) TO anon, authenticated;

-- ─── 3. fn_health_q_create_token (p_lang 추가) ───────────────────────────────
-- 시그니처 변경(5-arg → 6-arg)이므로 기존 함수 DROP 후 재생성.
DROP FUNCTION IF EXISTS fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION fn_health_q_create_token(
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_form_type    TEXT    DEFAULT 'general',
  p_check_in_id  UUID    DEFAULT NULL,
  p_expires_days INT     DEFAULT 7,
  p_lang         TEXT    DEFAULT 'ko'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
  v_lang      TEXT;
BEGIN
  -- lang 정규화 (허용값 외 → ko)
  v_lang := CASE WHEN p_lang = 'en' THEN 'en' ELSE 'ko' END;

  -- 직원 권한 확인
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- 기존 미사용 토큰 만료 (1인 1활성토큰)
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = p_customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = p_form_type
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- 새 토큰 발급
  v_new_token := encode(gen_random_bytes(24), 'base64url');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, lang, expires_at, created_by
  )
  VALUES (
    v_new_token,
    p_customer_id,
    p_clinic_id,
    p_check_in_id,
    p_form_type,
    v_lang,
    now() + (p_expires_days || ' days')::INTERVAL,
    v_staff_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'token',   v_new_token,
    'id',      v_new_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT, TEXT) TO authenticated;

-- ─── PostgREST schema cache 강제 reload ──────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');

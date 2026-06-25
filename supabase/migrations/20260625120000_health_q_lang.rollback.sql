-- ROLLBACK: T-20260625-foot-FOREIGN-HEALTHQ-EN
-- 20260625120000_health_q_lang.sql 되돌리기
--
-- 1) fn_health_q_create_token 6-arg → 5-arg 원복
-- 2) fn_health_q_validate_token lang 반환 제거 (원복)
-- 3) health_q_tokens.lang 컬럼 제거
--
-- ⚠ lang 컬럼 DROP 시 해당 컬럼 데이터 소실. en 토큰은 모두 ko로 간주됨.
--    이미 제출된 health_q_results는 form_data JSONB만 사용하므로 영향 없음.

-- ─── 1. fn_health_q_create_token 원복 (6-arg DROP → 5-arg 재생성) ────────────
DROP FUNCTION IF EXISTS fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT, TEXT);

CREATE OR REPLACE FUNCTION fn_health_q_create_token(
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_form_type    TEXT    DEFAULT 'general',
  p_check_in_id  UUID    DEFAULT NULL,
  p_expires_days INT     DEFAULT 7
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
BEGIN
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = p_customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = p_form_type
    AND  used_at     IS NULL
    AND  expires_at  > now();

  v_new_token := encode(gen_random_bytes(24), 'base64url');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_new_token, p_customer_id, p_clinic_id, p_check_in_id,
    p_form_type, now() + (p_expires_days || ' days')::INTERVAL, v_staff_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'token', v_new_token, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT) TO authenticated;

-- ─── 2. fn_health_q_validate_token 원복 (lang 제거) ──────────────────────────
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
  SELECT * INTO v_tok FROM health_q_tokens WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;
  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_used');
  END IF;
  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;
  SELECT name INTO v_name FROM customers WHERE id = v_tok.customer_id;
  RETURN jsonb_build_object(
    'success',       true,
    'token_id',      v_tok.id,
    'customer_id',   v_tok.customer_id,
    'customer_name', COALESCE(v_name, ''),
    'clinic_id',     v_tok.clinic_id,
    'check_in_id',   v_tok.check_in_id,
    'form_type',     v_tok.form_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_validate_token(TEXT) TO anon, authenticated;

-- ─── 3. lang 컬럼 제거 ───────────────────────────────────────────────────────
ALTER TABLE health_q_tokens DROP COLUMN IF EXISTS lang;

-- ─── 4. health_q_results COMMENT 원복 ────────────────────────────────────────
COMMENT ON TABLE health_q_results IS
  'T-20260529-foot-HEALTH-Q-MOBILE: 고객이 모바일로 제출한 발건강질문지 구조화 데이터.
   form_data JSONB: {symptoms, nail_locations, pain_duration, pain_severity,
                     medical_history, medications, allergies, prior_conditions,
                     family_history, visit_purpose, referral_source}.
   storage_path: documents 버킷 JSON 경로 (optional 백업).';

SELECT pg_notify('pgrst', 'reload schema');

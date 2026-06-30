-- ROLLBACK: T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM
-- fn_health_q_create_token 을 REGRESS4(20260629143000) 정의로 복원 (인가 게이트 = staff.user_id only).
-- 토큰 본체(search_path/extensions.gen_random_bytes/encoding)는 동일하므로 변경 없음 — 인가 게이트만 회귀.

BEGIN;

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
SET search_path = public, extensions
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
  v_lang      TEXT;
BEGIN
  v_lang := COALESCE(NULLIF(p_lang, ''), 'ko');

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

  v_new_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, lang, expires_at, created_by
  )
  VALUES (
    v_new_token, p_customer_id, p_clinic_id, p_check_in_id,
    p_form_type, v_lang, now() + (p_expires_days || ' days')::INTERVAL, v_staff_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'token', v_new_token, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT, TEXT) TO authenticated;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');

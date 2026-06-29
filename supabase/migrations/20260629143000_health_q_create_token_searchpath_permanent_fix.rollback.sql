-- ROLLBACK: T-20260629-foot-HEALTHQ-SELFLINK-REGRESS4
--   fn_health_q_create_token(6-arg) 를 fix 직전 상태(= 20260625120000_health_q_lang.sql 정의)로 복원.
--   주의: 이 정의는 search_path=public + bare gen_random_bytes 라 자가작성 링크 생성이 다시 100% 실패한다.
--         (= 회귀 상태로 되돌림. DDL-diff 비교/긴급 원복 용도로만 사용.)
-- 데이터 변경/삭제 없음. 멱등.

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
SET search_path = public
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

  v_new_token := encode(gen_random_bytes(24), 'base64url');

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

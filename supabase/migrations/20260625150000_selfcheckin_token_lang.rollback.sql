-- 20260625150000_selfcheckin_token_lang.sql 되돌리기
-- 3-arg(p_lang) 함수를 DROP 하고 2-arg 원형(20260601173000 상태)으로 복원.
-- health_q_tokens.lang 컬럼은 20260625120000 소유 — 본 롤백에서 건드리지 않음.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_create_health_q_token(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_create_health_q_token(
  p_check_in_id UUID,
  p_clinic_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ci     check_ins%ROWTYPE;
  v_token  TEXT;
  v_tok_id UUID;
BEGIN
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_ci.customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_token, v_ci.customer_id, p_clinic_id, p_check_in_id,
    'general', now() + INTERVAL '24 hours', NULL
  )
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object('success', true, 'token', v_token, 'id', v_tok_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_create_health_q_token(UUID, UUID)
  TO anon, authenticated;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');

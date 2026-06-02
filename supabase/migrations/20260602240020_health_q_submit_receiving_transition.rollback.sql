-- T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-2 롤백
-- fn_health_q_submit 를 receiving→consult_waiting 전이 블록 제거한
-- 원본(20260529000000_health_q_mobile.sql) 버전으로 복원.

CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token        TEXT,
  p_form_data    JSONB,
  p_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok      health_q_tokens%ROWTYPE;
  v_result_id UUID;
BEGIN
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_submitted');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  INSERT INTO health_q_results (
    token_id, customer_id, clinic_id, check_in_id,
    form_type, form_data, storage_path, submitted_at
  )
  VALUES (
    v_tok.id, v_tok.customer_id, v_tok.clinic_id, v_tok.check_in_id,
    v_tok.form_type, p_form_data, p_storage_path, now()
  )
  RETURNING id INTO v_result_id;

  UPDATE health_q_tokens
  SET    used_at = now()
  WHERE  id = v_tok.id;

  RETURN jsonb_build_object(
    'success',    true,
    'result_id',  v_result_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT) TO anon, authenticated;

-- ROLLBACK: 20260731150000_foot_healthq_photo_upload.sql
-- T-20260731-foot-FOOTQST-PHOTO-UPLOAD 롤백.
--
-- ★버킷 foot-health-q-photos 는 삭제하지 않음(archive-first, hard-DELETE 금지 — 업로드된 PHI-image 보존).
--   미사용 empty private 버킷은 무해. 실제 object 정리는 별건 SOP(orphan_archive_first).
-- fn_health_q_submit 은 20260602240020(receiving 전이) 3-arg 정본으로 복원.

BEGIN;

DROP POLICY IF EXISTS "health_q_photos_obj_read" ON storage.objects;

DROP TABLE IF EXISTS public.health_q_photos;

DROP FUNCTION IF EXISTS fn_health_q_submit(TEXT, JSONB, TEXT, JSONB);

-- 20260602240020 정본 3-arg 복원
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

  IF v_tok.check_in_id IS NOT NULL THEN
    UPDATE check_ins
    SET    status = 'consult_waiting'
    WHERE  id = v_tok.check_in_id
      AND  status = 'receiving';

    IF FOUND THEN
      INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status)
      VALUES (v_tok.check_in_id, v_tok.clinic_id, 'receiving', 'consult_waiting');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'result_id',  v_result_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT) TO anon, authenticated;

COMMIT;

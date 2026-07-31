-- ROLLBACK: 20260731200000_foot_healthq_photo_foot_side.sql
-- T-20260731-foot-FOOTQST-PHOTO-2SLOT-LR-BOTTOM 롤백.
--
-- ADDITIVE 마이그(컬럼+partial index+RPC 확장)의 역연산.
--   ① partial unique index DROP → ② foot_side 컬럼 DROP(기존행 데이터 무손실 — 컬럼값은 부가 라벨)
--   ③ fn_health_q_submit(4-arg) 을 parent 정본(20260731150000, foot_side 무) 본문으로 복원.
-- ★버킷/RLS/CASCADE 계약 무변(§2-23) — 본 롤백 미접촉.

BEGIN;

DROP INDEX IF EXISTS public.uq_health_q_photos_result_side;

ALTER TABLE public.health_q_photos
  DROP COLUMN IF EXISTS foot_side;

-- parent 정본(20260731150000) 4-arg 본문 복원 (foot_side 무)
CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token        TEXT,
  p_form_data    JSONB,
  p_storage_path TEXT  DEFAULT NULL,
  p_photos       JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok       health_q_tokens%ROWTYPE;
  v_result_id UUID;
  v_prefix    TEXT;
  v_photo     JSONB;
  v_path      TEXT;
  v_ct        TEXT;
  v_size      INTEGER;
  v_idx       INTEGER := 0;
  v_inserted  INTEGER := 0;
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

  v_prefix := 'health-q/' || v_tok.clinic_id::text || '/' || p_token || '/';

  IF p_photos IS NOT NULL AND jsonb_typeof(p_photos) = 'array' THEN
    FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photos)
    LOOP
      EXIT WHEN v_inserted >= 10;
      v_path := v_photo ->> 'path';
      v_ct   := v_photo ->> 'content_type';
      v_size := NULLIF(v_photo ->> 'byte_size', '')::INTEGER;

      IF v_path IS NOT NULL AND left(v_path, length(v_prefix)) = v_prefix THEN
        INSERT INTO health_q_photos (
          result_id, clinic_id, storage_path, content_type, byte_size, sort_order
        )
        VALUES (
          v_result_id, v_tok.clinic_id, v_path, v_ct, v_size, v_idx
        );
        v_inserted := v_inserted + 1;
      END IF;
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

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
    'success',      true,
    'result_id',    v_result_id,
    'photos_saved', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT, JSONB) TO anon, authenticated;

COMMIT;

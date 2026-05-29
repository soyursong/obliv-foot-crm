-- 롤백: 20260529002000_selfcheckin_insurance_rrn_match.sql
-- AC-7: fn_selfcheckin_update_personal_info 를 p_insurance_consent 없는 v1으로 복원
-- AC-9: fn_selfcheckin_rrn_match 삭제

BEGIN;

-- AC-9: fn_selfcheckin_rrn_match 삭제
DROP FUNCTION IF EXISTS public.fn_selfcheckin_rrn_match(UUID, UUID);

-- AC-7: fn_selfcheckin_update_personal_info 7파라미터 버전 삭제 후 6파라미터 v1 복원
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id    UUID,
  p_clinic_id      UUID,
  p_birth_date     TEXT     DEFAULT NULL,
  p_address        TEXT     DEFAULT NULL,
  p_address_detail TEXT     DEFAULT NULL,
  p_privacy_consent BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
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

  UPDATE customers
  SET
    birth_date      = COALESCE(p_birth_date,      birth_date),
    address         = COALESCE(p_address,         address),
    address_detail  = COALESCE(p_address_detail,  address_detail),
    privacy_consent = COALESCE(p_privacy_consent, privacy_consent),
    updated_at      = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN)
  TO anon, authenticated;

COMMIT;

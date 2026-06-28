-- ============================================================
-- Rollback: foot_CONSENT-SENSITIVE — 민감정보 동의 3컬럼 + RPC 13-arg 롤백
-- Ticket: T-20260615-foot-CONSENT-SENSITIVE
-- ⚠ Step 3 컬럼 DROP 은 데이터 손실(수집된 민감정보 동의 소멸) — supervisor 판단 하에만 실행.
-- 함수만 되돌리고 컬럼은 유지하려면 Step 3 를 주석 처리한 채 실행.
-- ============================================================

BEGIN;

-- ─── Step 1: 13-arg 함수 제거 후 10-arg(20260611100000 canonical) 복원 ───
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id        UUID,
  p_clinic_id          UUID,
  p_birth_date         TEXT     DEFAULT NULL,
  p_address            TEXT     DEFAULT NULL,
  p_address_detail     TEXT     DEFAULT NULL,
  p_postal_code        TEXT     DEFAULT NULL,
  p_privacy_consent    BOOLEAN  DEFAULT NULL,
  p_insurance_consent  BOOLEAN  DEFAULT NULL,
  p_visit_route        TEXT     DEFAULT NULL,
  p_visit_route_detail TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
BEGIN
  SELECT * INTO v_ci FROM check_ins WHERE id = p_check_in_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found'); END IF;
  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN RETURN jsonb_build_object('success', false, 'error', 'too_old'); END IF;
  IF v_ci.customer_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_customer_id'); END IF;

  UPDATE customers
  SET
    birth_date         = COALESCE(p_birth_date,         birth_date),
    address            = COALESCE(p_address,            address),
    address_detail     = COALESCE(p_address_detail,     address_detail),
    postal_code        = COALESCE(p_postal_code,        postal_code),
    privacy_consent    = COALESCE(p_privacy_consent,    privacy_consent),
    privacy_consent_at = CASE WHEN p_privacy_consent = true THEN now()
                              WHEN p_privacy_consent = false THEN NULL
                              ELSE privacy_consent_at END,
    visit_route        = COALESCE(p_visit_route,        visit_route),
    visit_route_detail = COALESCE(p_visit_route_detail, visit_route_detail),
    hira_consent       = CASE WHEN p_insurance_consent = true THEN true ELSE hira_consent END,
    hira_consent_at    = CASE WHEN p_insurance_consent = true THEN now() ELSE hira_consent_at END,
    updated_at         = now()
  WHERE id = v_ci.customer_id AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO anon, authenticated;

-- ─── Step 2: fn_selfcheckin_rrn_match — 20260611140000 버전(consent_sensitive 이관 이전)으로 복원 ───
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_rrn_match(
  p_check_in_id  UUID,
  p_clinic_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci             check_ins%ROWTYPE;
  v_self_bd        TEXT;
  v_self_cust_id   UUID;
  v_target_cust_id UUID;
  v_today          DATE;
BEGIN
  SELECT * INTO v_ci FROM check_ins WHERE id = p_check_in_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found'); END IF;
  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN RETURN jsonb_build_object('success', false, 'error', 'too_old'); END IF;
  IF v_ci.customer_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_customer_id'); END IF;

  v_self_cust_id := v_ci.customer_id;
  SELECT birth_date INTO v_self_bd FROM customers WHERE id = v_self_cust_id;
  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  SELECT c.id INTO v_target_cust_id
  FROM customers c
  JOIN check_ins ci ON ci.customer_id = c.id
  WHERE c.clinic_id = p_clinic_id
    AND c.id <> v_self_cust_id
    AND c.birth_date = v_self_bd
    AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::DATE = v_today
    AND ci.status <> 'cancelled'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_target_cust_id IS NULL THEN RETURN jsonb_build_object('success', true, 'matched', false); END IF;

  UPDATE check_ins SET customer_id = v_target_cust_id WHERE id = p_check_in_id;

  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,      dest.birth_date),
    address            = COALESCE(src.address,         dest.address),
    postal_code        = COALESCE(src.postal_code,     dest.postal_code),
    address_detail     = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                              THEN src.hira_consent_at ELSE dest.hira_consent_at END,
    privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
    privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
                              THEN src.privacy_consent_at ELSE dest.privacy_consent_at END,
    sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
    sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
                              THEN src.sms_opt_in_at ELSE dest.sms_opt_in_at END,
    updated_at         = now()
  FROM customers src
  WHERE dest.id = v_target_cust_id AND src.id = v_self_cust_id;

  IF NOT EXISTS (SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'matched', true, 'merged_to_customer_id', v_target_cust_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID) TO anon, authenticated;

-- ─── Step 3: 3컬럼 제거 (데이터 손실 주의 — 롤백 시 동의 데이터 소멸) ───
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS consent_sensitive,
  DROP COLUMN IF EXISTS consent_agreed_at,
  DROP COLUMN IF EXISTS consent_version;

NOTIFY pgrst, 'reload schema';

COMMIT;

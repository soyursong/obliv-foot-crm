-- T-20260602-foot-CONSENT-TIMESTAMP-COLS rollback
-- 1) fn_selfcheckin_update_personal_info 를 v2(20260529002000) 상태로 복원 (privacy_consent_at 미기록)
-- 2) 신규 컬럼 2개 제거
--
-- 주의: 컬럼 DROP 은 데이터 손실. 운영 중 기록된 동의 시각이 사라진다.
--       롤백이 정말 필요한 경우에만 실행할 것.

BEGIN;

-- ─── 1. RPC v2 복원 (privacy_consent_at 라인 제거) ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id      UUID,
  p_clinic_id        UUID,
  p_birth_date       TEXT     DEFAULT NULL,
  p_address          TEXT     DEFAULT NULL,
  p_address_detail   TEXT     DEFAULT NULL,
  p_privacy_consent  BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN DEFAULT NULL
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
    birth_date        = COALESCE(p_birth_date,      birth_date),
    address           = COALESCE(p_address,         address),
    address_detail    = COALESCE(p_address_detail,  address_detail),
    privacy_consent   = COALESCE(p_privacy_consent, privacy_consent),
    hira_consent      = CASE
                          WHEN p_insurance_consent = true THEN true
                          ELSE hira_consent
                        END,
    hira_consent_at   = CASE
                          WHEN p_insurance_consent = true THEN now()
                          ELSE hira_consent_at
                        END,
    updated_at        = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO anon, authenticated;

-- ─── 2. 신규 컬럼 제거 ──────────────────────────────────────────────────────
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS privacy_consent_at,
  DROP COLUMN IF EXISTS sms_opt_in_at;

COMMIT;

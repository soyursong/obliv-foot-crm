-- ROLLBACK — T-20260628-foot-ANON-KIOSK-CUTOVER L1730 (DA-ow58)
--   20260719160000_selfcheckin_update_personal_info_contact_additive.sql 역적용.
--
-- 동작: 15-arg 시그니처 DROP → 20260629120000_foot_consent_sensitive canonical 13-arg 복원.
--   데이터·컬럼 무변경(ADDITIVE 역행 = 시그니처만 축소). sms_opt_in/customer_email 컬럼은 v3 가
--   여전히 사용하므로 DROP 하지 않음(공유 컬럼).
--
-- ⚠ 롤백 후 FE(15-arg named call: p_sms_opt_in/p_customer_email 포함)는 PGRST202 가 되므로,
--   FE 롤백(또는 미배포)과 짝을 맞춰 적용할 것. 컷오버 FE 는 field-window LIVE 배포 hold 상태이므로
--   마이그 단독 롤백 시 무회귀(구 FE = 13-arg, 신규 컬럼 미참조).
--
-- 실행: supabase db push --file supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.rollback.sql

BEGIN;

-- 15-arg 제거
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT
);

-- 20260629120000 canonical 13-arg 복원
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
  p_visit_route_detail TEXT     DEFAULT NULL,
  p_consent_sensitive  BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at  TIMESTAMPTZ DEFAULT NULL,
  p_consent_version    TEXT        DEFAULT NULL
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
    birth_date         = COALESCE(p_birth_date,         birth_date),
    address            = COALESCE(p_address,            address),
    address_detail     = COALESCE(p_address_detail,     address_detail),
    postal_code        = COALESCE(p_postal_code,        postal_code),
    privacy_consent    = COALESCE(p_privacy_consent,    privacy_consent),
    privacy_consent_at = CASE
                           WHEN p_privacy_consent = true  THEN now()
                           WHEN p_privacy_consent = false THEN NULL
                           ELSE privacy_consent_at
                         END,
    visit_route        = COALESCE(p_visit_route,        visit_route),
    visit_route_detail = COALESCE(p_visit_route_detail, visit_route_detail),
    hira_consent       = CASE
                           WHEN p_insurance_consent = true THEN true
                           ELSE hira_consent
                         END,
    hira_consent_at    = CASE
                           WHEN p_insurance_consent = true THEN now()
                           ELSE hira_consent_at
                         END,
    consent_sensitive  = CASE
                           WHEN p_consent_sensitive = true THEN true
                           ELSE consent_sensitive
                         END,
    consent_agreed_at  = CASE
                           WHEN p_consent_sensitive = true
                             THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                           ELSE consent_agreed_at
                         END,
    consent_version    = CASE
                           WHEN p_consent_sensitive = true
                             THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                           ELSE consent_version
                         END,
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260611-CONSOLIDATE + T-20260615-CONSENT-SENSITIVE: 초진 셀프접수 개인정보 저장 13-arg (rollback 복원).';

COMMIT;

-- ROLLBACK: T-20260609-foot-SELFCHECKIN-ADDR-3COL-SPLIT
--
-- fn_selfcheckin_update_personal_info 를 p_postal_code 추가 이전(9-arg, 20260609234500)으로 복원.
-- 10-arg 시그니처 DROP 후 9-arg 재생성 (오버로드 모호성 방지).
--
-- ⚠ 주의: 이 롤백을 적용하면 FE(foot-checkin)가 p_postal_code 를 전달하는 경우
--   PostgREST 시그니처 불일치로 RPC 가 실패한다. FE 를 먼저 롤백한 뒤 본 DB 롤백을 적용할 것.
--   (FE 미배포 상태에서의 긴급 DB 롤백 전용)
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260609235500_selfcheckin_personal_info_postal_code.rollback.sql

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id       UUID,
  p_clinic_id         UUID,
  p_birth_date        TEXT     DEFAULT NULL,
  p_address           TEXT     DEFAULT NULL,
  p_address_detail    TEXT     DEFAULT NULL,
  p_privacy_consent   BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN  DEFAULT NULL,
  p_visit_route       TEXT     DEFAULT NULL,
  p_visit_route_detail TEXT    DEFAULT NULL
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
    birth_date         = COALESCE(p_birth_date,        birth_date),
    address            = COALESCE(p_address,           address),
    address_detail     = COALESCE(p_address_detail,    address_detail),
    privacy_consent    = COALESCE(p_privacy_consent,   privacy_consent),
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
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO anon, authenticated;

COMMIT;

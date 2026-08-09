-- ROLLBACK: T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT (§24 고유식별정보 별도동의)
-- ════════════════════════════════════════════════════════════════════════════
-- 대칭 down (VG5): up 의 역순 —
--   1) resolve_v4 DROP (신규 함수 — 구 resolve_v3 15-arg 는 무접촉·잔존)
--   2) fn_selfcheckin_update_personal_info 14-arg DROP → 13-arg(§23 시점, 20260629120000) 복원
--   3) fn_selfcheckin_rrn_match → §23 시점(20260629120000) 본문 복원(consent_unique_id 이관 제거)
--   4) customers.consent_unique_id 컬럼 DROP
-- 순서 근거: 컬럼을 참조하는 함수(resolve_v4 / 14-arg personal_info / unique_id 이관 rrn_match)를
--   먼저 제거/복원한 뒤 컬럼 DROP → dependency 안전. consent_agreed_at/version/sensitive 는 §23 소유(무접촉).
-- author: dev-foot / 2026-08-09
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. resolve_v4 DROP ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_selfcheckin_upsert_customer_resolve_v4(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN
);

-- ─── 2. fn_selfcheckin_update_personal_info 14-arg DROP → 13-arg(§23) 복원 ────
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN  -- 14-arg
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

-- ─── 3. fn_selfcheckin_rrn_match → §23 시점 본문 복원(consent_unique_id 이관 제거) ────────────
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

  v_self_cust_id := v_ci.customer_id;

  SELECT birth_date INTO v_self_bd
  FROM   customers
  WHERE  id = v_self_cust_id;

  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  SELECT c.id INTO v_target_cust_id
  FROM   customers c
  JOIN   check_ins ci ON ci.customer_id = c.id
  WHERE  c.clinic_id  = p_clinic_id
    AND  c.id        <> v_self_cust_id
    AND  c.birth_date = v_self_bd
    AND  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::DATE = v_today
    AND  ci.status   <> 'cancelled'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,      dest.birth_date),
    address            = COALESCE(src.address,         dest.address),
    postal_code        = COALESCE(src.postal_code,     dest.postal_code),
    address_detail     = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                              THEN src.hira_consent_at
                             ELSE dest.hira_consent_at
                        END,
    privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
    privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
                              THEN src.privacy_consent_at
                             ELSE dest.privacy_consent_at
                        END,
    sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
    sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
                              THEN src.sms_opt_in_at
                             ELSE dest.sms_opt_in_at
                        END,
    consent_sensitive  = CASE WHEN src.consent_sensitive = true THEN true ELSE dest.consent_sensitive END,
    consent_agreed_at  = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_agreed_at
                             ELSE dest.consent_agreed_at
                        END,
    consent_version    = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_version
                             ELSE dest.consent_version
                        END,
    updated_at         = now()
  FROM customers src
  WHERE dest.id   = v_target_cust_id
    AND src.id    = v_self_cust_id;

  IF NOT EXISTS (
    SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id
  ) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'success',               true,
    'matched',               true,
    'merged_to_customer_id', v_target_cust_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID)
  TO anon, authenticated;

-- ─── 4. customers.consent_unique_id 컬럼 DROP (모든 참조 함수 제거/복원 후) ─────────────────────
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS consent_unique_id;

NOTIFY pgrst, 'reload schema';

COMMIT;

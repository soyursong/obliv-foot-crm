-- ROLLBACK: T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH (수정2)
--
-- 복원 내용:
--   1. fn_selfcheckin_update_personal_info → 9-arg DROP 후 20260529002000 의 7-arg 버전 복원
--   2. fn_selfcheckin_rrn_match → 20260609230000(addr_sync) 버전(visit_route 병합 이전)으로 복원
--   3. customers.visit_route_detail 컬럼 DROP
--
-- 주의: 컬럼 DROP 시 그동안 저장된 소분류 데이터 유실. 데이터 보존이 필요하면 컬럼 DROP만 생략 가능.
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260609234500_selfcheckin_visit_route_detail.rollback.sql

BEGIN;

-- ─── 1. update_personal_info 7-arg 버전 복원 ───
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id       UUID,
  p_clinic_id         UUID,
  p_birth_date        TEXT     DEFAULT NULL,
  p_address           TEXT     DEFAULT NULL,
  p_address_detail    TEXT     DEFAULT NULL,
  p_privacy_consent   BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN  DEFAULT NULL
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

-- ─── 2. rrn_match 를 addr_sync(20260609230000) 버전으로 복원 (visit_route 병합 제거) ───
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
    birth_date      = COALESCE(src.birth_date,      dest.birth_date),
    address         = COALESCE(src.address,         dest.address),
    postal_code     = COALESCE(src.postal_code,     dest.postal_code),
    address_detail  = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent    = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                            THEN src.hira_consent_at
                           ELSE dest.hira_consent_at
                      END,
    updated_at      = now()
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

-- ─── 3. 소분류 컬럼 제거 ───
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS visit_route_detail;

COMMIT;

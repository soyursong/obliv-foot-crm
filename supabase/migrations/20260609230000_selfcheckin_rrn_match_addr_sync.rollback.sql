-- ROLLBACK: T-20260609-foot-SELFREG-ADDR-SYNC
-- fn_selfcheckin_rrn_match 를 20260529002000 버전(postal_code/address_detail 병합 이전)으로 복원.
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260609230000_selfcheckin_rrn_match_addr_sync.rollback.sql

BEGIN;

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
    birth_date    = COALESCE(src.birth_date,   dest.birth_date),
    address       = COALESCE(src.address,      dest.address),
    hira_consent  = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                            THEN src.hira_consent_at
                           ELSE dest.hira_consent_at
                      END,
    updated_at    = now()
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

COMMENT ON FUNCTION public.fn_selfcheckin_rrn_match IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-9: 셀프접수 주민번호 자동 매칭.'
  ' birth_date(앞6자리) + 당일 check_in 조건으로 데스크 기입 레코드와 병합.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;

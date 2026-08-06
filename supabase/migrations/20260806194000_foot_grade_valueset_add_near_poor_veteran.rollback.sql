-- ROLLBACK — 20260806194000_foot_grade_valueset_add_near_poor_veteran.sql
-- T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — AC-0 롤백 (near_poor·veteran 제거)
--
-- ⚠ 선행조건: near_poor/veteran 값을 실제 사용 중인 행이 없어야 CHECK 축소가 가능.
--    (배포 직후 롤백 = 미사용 → 안전. 사용 후 롤백 시 아래 가드가 abort.)

DO $$
DECLARE
  v_name TEXT;
  v_inuse INT;
BEGIN
  -- near_poor/veteran 사용 행 존재 시 abort (데이터 유실 방지)
  SELECT count(*) INTO v_inuse FROM customers WHERE insurance_grade IN ('near_poor','veteran');
  IF v_inuse > 0 THEN
    RAISE EXCEPTION 'ROLLBACK ABORT — customers.insurance_grade 에 near_poor/veteran 사용 행 % 건 존재. 축소 시 CHECK 위반. 먼저 해당 행 재분류 후 롤백.', v_inuse;
  END IF;

  SELECT c.conname INTO v_name
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'customers' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%insurance_grade %'
    AND pg_get_constraintdef(c.oid) NOT ILIKE '%insurance_grade_source%'
  LIMIT 1;
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE customers DROP CONSTRAINT %I', v_name);
  END IF;

  -- 원복: 9값 CHECK
  ALTER TABLE customers ADD CONSTRAINT customers_insurance_grade_check CHECK (
    insurance_grade IS NULL OR insurance_grade IN (
      'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
      'infant','elderly_flat','foreigner','unverified'
    )
  );
END $$;

COMMENT ON COLUMN customers.insurance_grade IS
  '건보 자격 등급 (general/low_income_*/medical_aid_*/infant/elderly_flat/foreigner/unverified)';

-- update_insurance_grade RPC allowlist 9값 원복
CREATE OR REPLACE FUNCTION update_insurance_grade(
  p_customer_id UUID,
  p_grade       TEXT,
  p_source      TEXT,
  p_memo        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clinic UUID;
  v_cust_clinic   UUID;
  v_found         BOOLEAN;
  v_rows          INTEGER;
BEGIN
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '승인되지 않은 사용자입니다. 관리자에게 문의하세요.');
  END IF;
  IF NOT (is_floor_staff() OR is_consultant_or_above() OR is_coordinator_or_above()) THEN
    RETURN jsonb_build_object('ok', false, 'error', '보험 자격등급을 변경할 권한이 없습니다.');
  END IF;
  IF p_grade IS NULL OR p_grade NOT IN (
    'general','low_income_1','low_income_2','medical_aid_1','medical_aid_2',
    'infant','elderly_flat','foreigner','unverified'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('허용되지 않은 자격등급입니다(%s).', COALESCE(p_grade, 'NULL')));
  END IF;
  IF p_source IS NULL OR p_source NOT IN (
    'jeoneung_crm','eligibility_cert','hira_lookup','manual_input'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('허용되지 않은 등급 출처입니다(%s).', COALESCE(p_source, 'NULL')));
  END IF;
  SELECT (id IS NOT NULL), clinic_id INTO v_found, v_cust_clinic
  FROM customers WHERE id = p_customer_id;
  IF NOT COALESCE(v_found, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상 고객을 찾지 못했습니다.');
  END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NOT NULL AND v_cust_clinic IS NOT NULL AND v_cust_clinic <> v_caller_clinic THEN
    RETURN jsonb_build_object('ok', false, 'error', '다른 지점 고객의 자격등급은 변경할 수 없습니다.');
  END IF;
  UPDATE customers
  SET insurance_grade             = p_grade,
      insurance_grade_source      = p_source,
      insurance_grade_verified_at = now(),
      insurance_grade_memo        = p_memo
  WHERE id = p_customer_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장 대상을 찾지 못했습니다. 다시 시도해 주세요.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'customer_id', p_customer_id, 'grade', p_grade);
END;
$$;

REVOKE ALL ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_insurance_grade(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ROLLBACK T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY
-- 20260725180000_foot_consultfee_surcharge_servicecharge_persist.sql 역적용.
--   calc_copayment v1.7(5-arg) → v1.6(4-arg, 20260720193000) 복원.
--   record_insurance_consult_payment v2(7-arg) → v1(6-arg, 20260715160000) 복원.
-- ⚠ going-forward 전용 write-path 만 복원 — 이미 적재된 service_charges/payments 행은 무접촉(소급 정정은 별건 백필 SOP).
--   롤백 후 신규 진찰료 가산은 service_charges 에 다시 미영속(base 저계상 상태로 회귀) — 데이터 손실 아님(payments 는 07458cf6 로 잔존).
-- 재실행 안전: DROP FUNCTION IF EXISTS + CREATE. txn 제어문 미포함(dry-run no-persistence 준수).

-- ── 1) calc_copayment v1.6 복원 (5-arg DROP → 4-arg CREATE) ──
DROP FUNCTION IF EXISTS calc_copayment(UUID, UUID, UUID, DATE, NUMERIC);

CREATE FUNCTION calc_copayment(
  p_service_id UUID,
  p_customer_id UUID,
  p_clinic_id UUID,
  p_visit_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  base_amount INTEGER,
  insurance_covered_amount INTEGER,
  copayment_amount INTEGER,
  exempt_amount INTEGER,
  applied_rate NUMERIC,
  applied_grade TEXT,
  data_incomplete BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_service services%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_clinic clinics%ROWTYPE;
  v_grade TEXT;
  v_rate NUMERIC;
  v_base INT;
  v_copay INT;
  v_covered INT;
  v_exempt INT := 0;
BEGIN
  SELECT * INTO v_service FROM services WHERE id = p_service_id;
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic_id;

  IF v_service.id IS NULL THEN
    RAISE EXCEPTION 'service not found: %', p_service_id;
  END IF;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'customer not found: %', p_customer_id;
  END IF;
  IF v_clinic.id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_id;
  END IF;

  v_grade := COALESCE(v_customer.insurance_grade, 'unverified');

  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
    RETURN;
  END IF;

  IF v_service.hira_score IS NULL THEN
    IF v_grade = 'general' THEN
      v_base := COALESCE(v_service.price, 0);
      RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
      RETURN;
    ELSE
      RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
      RETURN;
    END IF;
  END IF;

  IF v_clinic.hira_unit_value IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
    RETURN;
  END IF;

  v_base := ROUND(v_service.hira_score * v_clinic.hira_unit_value);

  v_rate := CASE v_grade
    WHEN 'general' THEN 0.30
    WHEN 'low_income_1' THEN 0.00
    WHEN 'low_income_2' THEN 0.00
    WHEN 'medical_aid_1' THEN 0.00
    WHEN 'medical_aid_2' THEN 0.00
    WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30
    ELSE 0.30
  END;

  IF v_service.copayment_rate_override IS NOT NULL THEN
    v_rate := v_service.copayment_rate_override;
  END IF;

  IF v_grade = 'low_income_1' THEN
    v_copay := 0;
    v_covered := v_base;
    v_exempt := 0;

  ELSIF v_grade IN ('medical_aid_1', 'low_income_2', 'medical_aid_2') THEN
    v_copay := LEAST(1000, v_base);
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSIF v_grade = 'elderly_flat' AND v_service.copayment_rate_override IS NULL THEN
    IF v_base <= 15000 THEN
      v_copay := LEAST(1500, v_base);
    ELSIF v_base <= 20000 THEN
      v_copay := FLOOR((v_base * 0.10) / 100.0) * 100;
    ELSIF v_base <= 25000 THEN
      v_copay := FLOOR((v_base * 0.20) / 100.0) * 100;
    ELSE
      v_copay := FLOOR((v_base * 0.30) / 100.0) * 100;
    END IF;
    IF v_copay > v_base THEN
      v_copay := v_base;
    END IF;
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSE
    v_copay := FLOOR((v_base * v_rate) / 100.0) * 100;
    IF v_copay > v_base THEN
      v_copay := v_base;
    END IF;
    v_covered := v_base - v_copay;
    v_exempt := 0;
  END IF;

  RETURN QUERY SELECT v_base, v_covered, v_copay, v_exempt, v_rate, v_grade, false;
END;
$$;

REVOKE ALL ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) TO authenticated;

-- ── 2) record_insurance_consult_payment v1 복원 (7-arg DROP → 6-arg CREATE) ──
DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC);

CREATE FUNCTION record_insurance_consult_payment(
  p_check_in_id UUID,
  p_customer_id UUID,
  p_clinic_id   UUID,
  p_service_id  UUID,
  p_method      TEXT,
  p_visit_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  service_charge_id        UUID,
  payment_id               UUID,
  base_amount              INTEGER,
  copayment_amount         INTEGER,
  insurance_covered_amount INTEGER,
  customer_grade_at_charge  TEXT,
  data_incomplete          BOOLEAN,
  idempotent_hit           BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_service         services%ROWTYPE;
  v_clinic          clinics%ROWTYPE;
  v_calc            RECORD;
  v_sc_id           UUID;
  v_pay_id          UUID;
  v_covered         INT;
  v_grade_confirmed BOOLEAN;
  v_existing_sc     service_charges%ROWTYPE;
  v_existing_pay    UUID;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('card','cash','transfer','membership') THEN
    RAISE EXCEPTION 'invalid payment method: %', p_method;
  END IF;

  SELECT * INTO v_service FROM services WHERE id = p_service_id;
  IF v_service.id IS NULL THEN
    RAISE EXCEPTION 'service not found: %', p_service_id;
  END IF;
  IF NOT COALESCE(v_service.is_insurance_covered, false) THEN
    RAISE EXCEPTION 'service % is not insurance-covered — consult write-path is 급여 only', p_service_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_check_in_id::text || ':' || p_service_id::text));

  SELECT sc.* INTO v_existing_sc
  FROM service_charges sc
  WHERE sc.check_in_id = p_check_in_id
    AND sc.service_id  = p_service_id
    AND sc.is_insurance_covered = TRUE
    AND sc.calculation_engine_version = 'consult_writepath_v1'
  ORDER BY sc.calculated_at DESC
  LIMIT 1;

  IF v_existing_sc.id IS NOT NULL THEN
    SELECT p.id INTO v_existing_pay
    FROM payments p
    WHERE p.service_charge_id = v_existing_sc.id
    LIMIT 1;

    IF v_existing_pay IS NOT NULL THEN
      RETURN QUERY SELECT
        v_existing_sc.id, v_existing_pay, v_existing_sc.base_amount,
        v_existing_sc.copayment_amount, v_existing_sc.insurance_covered_amount,
        v_existing_sc.customer_grade_at_charge, false, true;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic_id;
  IF v_clinic.id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_id;
  END IF;

  SELECT * INTO v_calc
  FROM calc_copayment(p_service_id, p_customer_id, p_clinic_id, p_visit_date);

  IF v_calc.data_incomplete THEN
    RAISE EXCEPTION 'calc_copayment data_incomplete (service=%, grade=%) — 명세 생성 불가(§2-2-1b)',
      p_service_id, v_calc.applied_grade
      USING HINT = 'hira_score/hira_unit_value(clinics.hira_unit_value) 또는 자격등급 미비 확인';
  END IF;

  v_grade_confirmed := (v_calc.applied_grade IS NOT NULL AND v_calc.applied_grade <> 'unverified');
  v_covered := CASE WHEN v_grade_confirmed THEN v_calc.insurance_covered_amount ELSE 0 END;

  INSERT INTO service_charges (
    clinic_id, check_in_id, customer_id, service_id,
    is_insurance_covered, hira_score, hira_unit_value, hira_unit_value_year,
    base_amount, insurance_covered_amount, copayment_amount, exempt_amount,
    customer_grade_at_charge, copayment_rate_at_charge,
    calculation_engine_version
  ) VALUES (
    p_clinic_id, p_check_in_id, p_customer_id, p_service_id,
    TRUE, v_service.hira_score, v_clinic.hira_unit_value, v_clinic.hira_unit_value_year,
    v_calc.base_amount, v_covered, v_calc.copayment_amount, v_calc.exempt_amount,
    v_calc.applied_grade, v_calc.applied_rate,
    'consult_writepath_v1'
  )
  RETURNING id INTO v_sc_id;

  INSERT INTO payments (
    check_in_id, clinic_id, customer_id, amount, method,
    payment_type, tax_type, service_charge_id
  ) VALUES (
    p_check_in_id, p_clinic_id, p_customer_id, v_calc.copayment_amount, p_method,
    'payment', NULL, v_sc_id
  )
  RETURNING id INTO v_pay_id;

  RETURN QUERY SELECT
    v_sc_id, v_pay_id, v_calc.base_amount,
    v_calc.copayment_amount, v_covered, v_calc.applied_grade, false, false;
END;
$$;

REVOKE ALL ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE) TO authenticated;

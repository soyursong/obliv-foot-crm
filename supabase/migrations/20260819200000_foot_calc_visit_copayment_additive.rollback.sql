-- ROLLBACK: T-20260819-foot-COPAY-VISIT-GRAIN — 방문 grain 재산출 원복.
--
-- 원복 대상(2건, forward 마이그와 짝):
--   1) calc_visit_copayment (신규 ADDITIVE) → DROP.
--   2) record_insurance_consult_payment 8-arg(v3) → DROP 후 7-arg(v2, 20260725180000) 재생성.
-- calc_copayment(v1.7)는 본 티켓 무접촉 → 원복 불요. 기존 service_charges/payments 행 UPDATE 0 → 데이터 손실 없음.
-- FE 롤백(calc_visit_copayment 호출·p_visit_service_ids 전달 제거)과 짝. ⚠ Dry-Run No-Persistence: txn 제어문 미포함.

DROP FUNCTION IF EXISTS calc_visit_copayment(UUID[], UUID, UUID, DATE, NUMERIC);

DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID[]);

-- ── record_insurance_consult_payment v2 재생성 (7-arg, 20260725180000 verbatim) ──
CREATE FUNCTION record_insurance_consult_payment(
  p_check_in_id UUID,
  p_customer_id UUID,
  p_clinic_id   UUID,
  p_service_id  UUID,
  p_method      TEXT,
  p_visit_date  DATE DEFAULT CURRENT_DATE,
  p_surcharge_rate NUMERIC DEFAULT 0
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
  v_eff_rate        NUMERIC;
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

  v_eff_rate := CASE
    WHEN v_service.hira_category = 'consultation'
      THEN GREATEST(0, LEAST(1, COALESCE(p_surcharge_rate, 0)))
    ELSE 0
  END;

  PERFORM pg_advisory_xact_lock(hashtext(p_check_in_id::text || ':' || p_service_id::text));

  SELECT sc.* INTO v_existing_sc
  FROM service_charges sc
  WHERE sc.check_in_id = p_check_in_id
    AND sc.service_id  = p_service_id
    AND sc.is_insurance_covered = TRUE
    AND sc.calculation_engine_version IN ('consult_writepath_v1', 'consult_writepath_v2')
  ORDER BY sc.calculated_at DESC
  LIMIT 1;

  IF v_existing_sc.id IS NOT NULL THEN
    SELECT p.id INTO v_existing_pay FROM payments p WHERE p.service_charge_id = v_existing_sc.id LIMIT 1;
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
  FROM calc_copayment(p_service_id, p_customer_id, p_clinic_id, p_visit_date, v_eff_rate);

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
    'consult_writepath_v2'
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

REVOKE ALL ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC) TO authenticated;

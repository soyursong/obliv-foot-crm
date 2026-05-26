-- T-20260526-foot-COPAY-MINI-BUG AC-2 ROLLBACK
-- calc_copayment 원복 (hira_score NULL 시 비급여 폴백 복원)

CREATE OR REPLACE FUNCTION calc_copayment(
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
  applied_grade TEXT
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

  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service not found: %', p_service_id; END IF;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'customer not found: %', p_customer_id; END IF;
  IF v_clinic.id IS NULL THEN RAISE EXCEPTION 'clinic not found: %', p_clinic_id; END IF;

  v_grade := COALESCE(v_customer.insurance_grade, 'unverified');

  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade;
    RETURN;
  END IF;

  IF v_service.hira_score IS NULL THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade;
    RETURN;
  END IF;

  v_rate := CASE v_grade
    WHEN 'general' THEN 0.30
    WHEN 'low_income_1' THEN 0.14
    WHEN 'low_income_2' THEN 0.14
    WHEN 'medical_aid_1' THEN 0.00
    WHEN 'medical_aid_2' THEN 0.15
    WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30
    ELSE 0.30
  END;

  IF v_service.copayment_rate_override IS NOT NULL THEN
    v_rate := v_service.copayment_rate_override;
  END IF;

  v_base := ROUND(v_service.hira_score * COALESCE(v_clinic.hira_unit_value, 89.4));

  IF v_grade = 'medical_aid_1' THEN
    v_copay := LEAST(1000, v_base);
    v_covered := v_base - v_copay;
  ELSIF v_grade = 'elderly_flat' AND v_base <= 15000 THEN
    v_copay := LEAST(1500, v_base);
    v_covered := v_base - v_copay;
  ELSE
    v_copay := CEIL((v_base * v_rate) / 100.0) * 100;
    IF v_copay > v_base THEN v_copay := v_base; END IF;
    v_covered := v_base - v_copay;
  END IF;

  RETURN QUERY SELECT v_base, v_covered, v_copay, v_exempt, v_rate, v_grade;
END;
$$;

REVOKE ALL ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) TO authenticated;

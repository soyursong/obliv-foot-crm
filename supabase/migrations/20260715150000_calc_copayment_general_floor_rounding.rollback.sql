-- ROLLBACK: T-20260715-foot-COPAY-GENERAL-CEIL-TO-FLOOR-FIX — calc_copayment v1.5 → v1.4 복원
--
-- 일반 정률경로(ELSE)만 FLOOR → CEIL(100원 절상) 원복. elderly 4구간(FLOOR)·기타 로직은 v1.4 그대로.
-- CREATE OR REPLACE (시그니처 동일). 20260714133000_calc_copayment_elderly_floor_rounding.sql 의
-- ELSE 경로(L141 CEIL) 상태와 동일하게 되돌린다.

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

  IF v_grade = 'medical_aid_1' THEN
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
    -- v1.4 원복: 일반 정률경로 100원 절상(CEIL).
    v_copay := CEIL((v_base * v_rate) / 100.0) * 100;
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

COMMENT ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) IS
  '건보 본인부담 산출 v1.4 — 노인 외래 정률구간 FLOOR, 일반 정률경로 CEIL(100원 절상). (rollback of v1.5 COPAY-GENERAL-CEIL-TO-FLOOR-FIX)';

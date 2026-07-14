-- ROLLBACK — T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM calc_copayment v1.4
-- → v1.3(20260714120500) 복원: 노인 정률구간 원단위 CEIL(100원 올림) 재적용.
-- ⚠ v1.3 이하(v1.2/v1.1) 로는 내리지 않음 — last-known-good = v1.3.
--   본 rollback 은 ROUNDING 델타(FLOOR→CEIL)만 되돌린다. hira governed/4구간/NULLFIX 전부 유지.

DROP FUNCTION IF EXISTS calc_copayment(UUID, UUID, UUID, DATE);

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
      v_copay := CEIL((v_base * 0.10) / 100.0) * 100;      -- 10% (v1.3 CEIL 복원)
    ELSIF v_base <= 25000 THEN
      v_copay := CEIL((v_base * 0.20) / 100.0) * 100;      -- 20% (v1.3 CEIL 복원)
    ELSE
      v_copay := CEIL((v_base * 0.30) / 100.0) * 100;      -- 30% (v1.3 CEIL 복원)
    END IF;
    IF v_copay > v_base THEN
      v_copay := v_base;
    END IF;
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSE
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
  '건보 본인부담 산출 v1.3 — [이슈1]점당단가 governed(hira_unit_value NULL→data_incomplete BLOCK, 89.4 fallback 제거) + [이슈2]노인 외래 정률제 4구간(≤15k=1500/≤20k=10%/≤25k=20%/>25k=30%). NULLFIX v1.2 default-deny 흡수(subsume). (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE, SSOT §2-2-0/1/3)';

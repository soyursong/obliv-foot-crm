-- T-20260526-foot-COPAY-MINI-BUG AC-2 — calc_copayment RPC 폴백 수정
--
-- 기존 문제: hira_score IS NULL 시 급여 항목도 비급여로 취급 → applied_rate=1.0
-- 수정 방향: 급여(is_insurance_covered=true) 항목에서 hira_score 미설정 시
--            services.price 를 base_amount 로 사용하여 등급별 copay 계산 수행
--
-- 영향 범위: 급여 항목 + hira_score NULL 인 서비스 (현재: AA154, AA254, AA155, AA222, AA157, D620300HZ)
-- rollback: 20260526110000_calc_copayment_price_fallback.down.sql

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

  -- 비급여 또는 외국인 → 전액 본인부담
  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade;
    RETURN;
  END IF;

  -- base_amount 결정:
  --   hira_score 설정된 경우 → score × unit_value (정밀 수가)
  --   hira_score NULL 인 급여 항목 → services.price 를 수가로 간주 (안전 폴백)
  IF v_service.hira_score IS NOT NULL THEN
    v_base := ROUND(v_service.hira_score * COALESCE(v_clinic.hira_unit_value, 89.4));
  ELSE
    v_base := COALESCE(v_service.price, 0);
  END IF;

  -- 등급별 기본 본인부담률
  v_rate := CASE v_grade
    WHEN 'general' THEN 0.30
    WHEN 'low_income_1' THEN 0.14
    WHEN 'low_income_2' THEN 0.14
    WHEN 'medical_aid_1' THEN 0.00
    WHEN 'medical_aid_2' THEN 0.15
    WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30  -- 정액제 분기는 별도
    ELSE 0.30
  END;

  -- service.copayment_rate_override 우선
  IF v_service.copayment_rate_override IS NOT NULL THEN
    v_rate := v_service.copayment_rate_override;
  END IF;

  -- 의료급여 1종 정액제: 1,000원
  IF v_grade = 'medical_aid_1' THEN
    v_copay := LEAST(1000, v_base);
    v_covered := v_base - v_copay;
    v_exempt := 0;
  -- 65세 정액제: 총진료비 ≤ 15,000원 시 1,500원
  ELSIF v_grade = 'elderly_flat' AND v_base <= 15000 THEN
    v_copay := LEAST(1500, v_base);
    v_covered := v_base - v_copay;
    v_exempt := 0;
  ELSE
    -- 100원 단위 절상 (CEIL((base*rate)/100)*100)
    v_copay := CEIL((v_base * v_rate) / 100.0) * 100;
    IF v_copay > v_base THEN
      v_copay := v_base;
    END IF;
    v_covered := v_base - v_copay;
    v_exempt := 0;
  END IF;

  RETURN QUERY SELECT v_base, v_covered, v_copay, v_exempt, v_rate, v_grade;
END;
$$;

REVOKE ALL ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) TO authenticated;

COMMENT ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) IS
  '건보 본인부담 산출 v1.1 — 급여+hira_score NULL 시 price 폴백 추가 (T-20260526-foot-COPAY-MINI-BUG)';

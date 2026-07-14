-- T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM — calc_copayment v1.4
--
-- ★ 정정: 노인 외래 정률구간(10/20/30%) 원단위 처리 = 100원 미만 절사(버림, FLOOR).
--    종전 v1.3 은 CEIL(100원 올림) → 정률구간 초과징수 관찰(경영BO 보고). FLOOR 로 교체.
--
-- 규정 근거 (조사관/주무관 소명용):
--   · 국민건강보험법 시행령 별표2 제19조 제1항: 외래 본인부담금 "100원 미만은 제외한다"
--       = 100원 미만 절사(버림). 법제처 https://www.law.go.kr
--   · 심평원 외래 본인부담기준표: 전 구분 "100원미만 절사" 동일. https://www.hira.or.kr
--   · 베가스 10원 단위 관찰(백승민)은 비급여/자보 혼재 추정 = 급여 외래 규정과 별도 → 폐기.
--
-- 본 마이그레이션 델타 (v1.3=20260714120500 대비):
--   [ROUNDING] elderly_flat 정률 3구간 CEIL((base*rate)/100)*100 → FLOOR((base*rate)/100)*100.
--     · ≤15,000 정액 1,500 구간 무영향 (절사 무관).
--     · 정액 구간 및 타 등급(general 등) 일반 정률경로(else)는 무변경 (본 티켓 스코프 밖).
--   [무영향] hira_unit_value governed(NULL→data_incomplete BLOCK), NULLFIX v1.2 default-deny,
--            의료급여 1종 MIN(1000,base), override 우선 4구간 미적용 — v1.3 로직 전부 유지.
--
-- 소급 = 범위 밖(forward-only). 기존 service_charges/payments 행 UPDATE 절대 금지.
--   (§5 초과징수 3건 정정 필요여부는 별도 FOLLOWUP 소명 — 본 마이그와 분리.)
-- rollback: 20260714133000_calc_copayment_elderly_floor_rounding.rollback.sql (→ v1.3 CEIL 복원)

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

  -- 비급여 또는 외국인 → 전액 본인부담 (정당한 비급여, data_incomplete=false)
  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
    RETURN;
  END IF;

  -- ── 급여 + hira_score NULL 분기 (NULLFIX v1.2 default-deny, §2-2-1a) ────────
  IF v_service.hira_score IS NULL THEN
    IF v_grade = 'general' THEN
      v_base := COALESCE(v_service.price, 0);
      RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
      RETURN;
    ELSE
      -- default-deny BLOCK: 금액 날조 금지 → 모든 금액 0, rate NULL, data_incomplete=true.
      RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
      RETURN;
    END IF;
  END IF;

  -- ── [이슈1] 점당단가 governed: NULL → data_incomplete BLOCK (89.4 fallback 제거, §2-2-1b) ──
  -- 하드코딩 상수 계산강행 금지. hira_unit_value 미세팅 = 데이터 불완전.
  IF v_clinic.hira_unit_value IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
    RETURN;
  END IF;

  -- ── 정상분기: hira_score + hira_unit_value 보유 급여건 ────────────────────────
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
    -- ── [이슈2] 노인 외래 정률제 4구간 (의원급, §2-2-3) ─────────────────────────
    -- override 가 있으면 4구간 미적용(개별 실손 자기부담률 우선, ELSE 정률경로로 흡수).
    -- ★[ROUNDING-CONFIRM] 정률구간 원단위 = 100원 미만 절사(FLOOR). 시행령 별표2 §19① "100원 미만 제외".
    IF v_base <= 15000 THEN
      v_copay := LEAST(1500, v_base);                       -- 정액 1,500 (절사 무영향)
    ELSIF v_base <= 20000 THEN
      v_copay := FLOOR((v_base * 0.10) / 100.0) * 100;      -- 10% · 100원 미만 절사
    ELSIF v_base <= 25000 THEN
      v_copay := FLOOR((v_base * 0.20) / 100.0) * 100;      -- 20% · 100원 미만 절사
    ELSE
      v_copay := FLOOR((v_base * 0.30) / 100.0) * 100;      -- 30% · 100원 미만 절사
    END IF;
    IF v_copay > v_base THEN
      v_copay := v_base;
    END IF;
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSE
    -- 일반 정률경로: 100원 절상 유지 (본 티켓 스코프 밖 — elderly 정률구간만 절사 정정).
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
  '건보 본인부담 산출 v1.4 — 노인 외래 정률구간(10/20/30%) 원단위 100원 미만 절사(FLOOR, 시행령 별표2 §19① "100원 미만 제외"). v1.3(CEIL 100원 올림) 초과징수 정정. hira_unit_value governed + 노인 4구간 + NULLFIX v1.2 default-deny 유지. (T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM, SSOT §2-2-0/1/3)';

-- T-20260629-foot-COPAYCALC-SERVER-NULLFIX — calc_copayment NULL분기 정정
--
-- SSOT: revenue_insurance_split_spec.md v1.3
--   §2-2-1a default-deny allowlist  +  §2-2-1b data_incomplete 컬럼 계약
-- DA CONSULT-REPLY: MSG-20260629-154450-utic (Q1+Q2 종결)
--
-- 문제 (v1.1, mig 20260526110000 L64-68):
--   급여 + hira_score NULL 분기가 services.price 를 수가로 간주해 등급률을 적용 →
--   SSOT가 인가한 적 없는 비표준 fallback. price×rate 로 covered 를 만들면
--   명세 근거 없는 phantom 공단부담액 → 공단 과대청구·역방향 환수(clawback) 리스크.
--
-- 정정 (v1.2):
--   ① price→등급률 경로 제거 (모든 등급 공통, phantom covered 생성 금지)
--   ② NULL분기 default-deny allowlist:
--        grade = 'general'  → 전액본인부담 fallback (copay=price, covered=0, rate=1.0)
--        그 외 일체(low_income_1/2·infant·unverified·미지 enum·NULL 포함) → BLOCK
--   ③ BLOCK 시맨틱 = data_incomplete=true 반환 (RAISE EXCEPTION 아님; §2-2-1b).
--        copay/covered 금액 날조 금지 (0 반환), rate=NULL.
--
-- ⚠ RETURNS TABLE 에 data_incomplete boolean 컬럼 추가 = ADDITIVE.
--   단, Postgres 는 CREATE OR REPLACE 로 return type 변경 불가 → DROP + CREATE 필요.
--   정상분기(hira_score 보유) 산출 로직은 무변경(AC-2 회귀 무변경).
-- rollback: 20260629190000_calc_copayment_nullfix_default_deny.rollback.sql

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

  -- ── 급여 + hira_score NULL 분기 (데이터 불완전 오류) ──────────────────
  -- price→등급률 경로 제거. default-deny allowlist (§2-2-1a v1.3).
  IF v_service.hira_score IS NULL THEN
    IF v_grade = 'general' THEN
      -- allowlist: 일반 등급만 전액본인부담 프리뷰 fallback 허용
      -- (법정 경감·정액이 없는 일반부담 경제학에서만 환수-안전)
      v_base := COALESCE(v_service.price, 0);
      RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
      RETURN;
    ELSE
      -- default-deny BLOCK: low_income_1/2·infant·unverified·미지 enum·NULL 일체.
      -- 금액 날조 금지 → 모든 금액 0, rate NULL, data_incomplete=true.
      -- phantom covered 생성 금지(covered=0). 정상 처리 = hira_score 적재 후 차지.
      RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
      RETURN;
    END IF;
  END IF;

  -- ── 정상분기: hira_score 보유 급여건 (v1.1 로직 무변경, AC-2) ─────────
  v_base := ROUND(v_service.hira_score * COALESCE(v_clinic.hira_unit_value, 89.4));

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
  ELSIF v_grade = 'elderly_flat' AND v_base <= 15000 THEN
    v_copay := LEAST(1500, v_base);
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
  '건보 본인부담 산출 v1.2 — 급여+hira_score NULL 분기 default-deny allowlist(general만 전액본인부담, 그 외 data_incomplete=true). price→등급률 phantom covered 제거 (T-20260629-foot-COPAYCALC-SERVER-NULLFIX, SSOT §2-2-1a/§2-2-1b v1.3)';

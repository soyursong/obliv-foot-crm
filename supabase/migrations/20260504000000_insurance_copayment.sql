-- T-20260504-foot-INSURANCE-COPAYMENT
-- 건보 본인부담분 자동 산출 — 환자 자격등급 + HIRA 수가 + 등급별 차등
-- Rollback: 20260504000000_insurance_copayment.down.sql
-- Created: 2026-05-04 (dev-foot)

-- ============================================================
-- 1) clinics: 환산지수(점수당 원) 정책 (clinic 단위, 매년 변경 가능)
-- ============================================================
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS hira_unit_value NUMERIC(8,2) DEFAULT 89.4,
  ADD COLUMN IF NOT EXISTS hira_unit_value_year INT DEFAULT 2024;

COMMENT ON COLUMN clinics.hira_unit_value IS 'HIRA 환산지수 (점수당 원) — 2024 기준 89.4원, 매년 변경';
COMMENT ON COLUMN clinics.hira_unit_value_year IS '환산지수 적용 연도';

-- ============================================================
-- 2) customers: 자격 정보
-- ============================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS rrn_vault_id UUID,
  ADD COLUMN IF NOT EXISTS insurance_grade TEXT
    CHECK (insurance_grade IS NULL OR insurance_grade IN (
      'general',
      'low_income_1',
      'low_income_2',
      'medical_aid_1',
      'medical_aid_2',
      'infant',
      'elderly_flat',
      'foreigner',
      'unverified'
    )),
  ADD COLUMN IF NOT EXISTS insurance_grade_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS insurance_grade_source TEXT
    CHECK (insurance_grade_source IS NULL OR insurance_grade_source IN (
      'jeoneung_crm',
      'eligibility_cert',
      'hira_lookup',
      'manual_input'
    )),
  ADD COLUMN IF NOT EXISTS insurance_grade_memo TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_insurance_grade ON customers(insurance_grade);

COMMENT ON COLUMN customers.rrn_vault_id IS 'Supabase Vault 참조 — 주민번호 평문 절대 저장 금지';
COMMENT ON COLUMN customers.insurance_grade IS '건보 자격 등급 (general/low_income_*/medical_aid_*/infant/elderly_flat/foreigner/unverified)';
COMMENT ON COLUMN customers.insurance_grade_source IS '등급 입력 출처 (jeoneung_crm/eligibility_cert/hira_lookup/manual_input)';

-- ============================================================
-- 3) services: 급여 정보 + HIRA 매핑
-- ============================================================
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_insurance_covered BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS hira_code TEXT,
  ADD COLUMN IF NOT EXISTS hira_score NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS hira_category TEXT
    CHECK (hira_category IS NULL OR hira_category IN (
      'consultation',
      'examination',
      'prescription',
      'procedure',
      'medication',
      'document'
    )),
  ADD COLUMN IF NOT EXISTS copayment_rate_override NUMERIC(4,3);

CREATE INDEX IF NOT EXISTS idx_services_hira_code ON services(hira_code) WHERE hira_code IS NOT NULL;

COMMENT ON COLUMN services.is_insurance_covered IS '건강보험 급여 항목 여부';
COMMENT ON COLUMN services.hira_code IS 'HIRA 행위 코드 (예: AA154, AA254)';
COMMENT ON COLUMN services.hira_score IS 'HIRA 점수 (환산지수 곱하면 수가)';
COMMENT ON COLUMN services.hira_category IS '카테고리 (consultation/examination/prescription/procedure/medication/document)';
COMMENT ON COLUMN services.copayment_rate_override IS '서비스별 본인부담률 오버라이드 (NULL=등급별 기본값)';

-- ============================================================
-- 4) service_charges (신규) — 결제별 수가 산출 이력 (감사·통계용)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  check_in_id UUID NOT NULL REFERENCES check_ins(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  service_id UUID NOT NULL REFERENCES services(id),

  is_insurance_covered BOOLEAN NOT NULL,
  hira_score NUMERIC(8,2),
  hira_unit_value NUMERIC(8,2) DEFAULT 89.4,
  base_amount INTEGER NOT NULL,
  insurance_covered_amount INTEGER DEFAULT 0,
  copayment_amount INTEGER NOT NULL,
  exempt_amount INTEGER DEFAULT 0,

  customer_grade_at_charge TEXT NOT NULL,
  copayment_rate_at_charge NUMERIC(4,3),

  calculated_at TIMESTAMPTZ DEFAULT now(),
  calculation_engine_version TEXT DEFAULT 'v1'
);

ALTER TABLE service_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON service_charges;
CREATE POLICY "auth_all" ON service_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_service_charges_check_in ON service_charges(check_in_id);
CREATE INDEX IF NOT EXISTS idx_service_charges_customer ON service_charges(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_charges_clinic_calculated ON service_charges(clinic_id, calculated_at DESC);

COMMENT ON TABLE service_charges IS '수가 산출 이력 — 결제 시점에 등급+환산지수+점수 스냅샷 보존 (감사/STATS용)';

-- ============================================================
-- 5) RPC calc_copayment — 등급별 본인부담 산출
-- ============================================================
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

  -- hira_score 미설정 시 비급여로 폴백 (안전)
  IF v_service.hira_score IS NULL THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade;
    RETURN;
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

  v_base := ROUND(v_service.hira_score * COALESCE(v_clinic.hira_unit_value, 89.4));

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
  '건보 본인부담 산출 — 등급별 차등 + 정액제(의료급여1종/65세) + 비급여/외국인 전액';

-- T-20260720-foot-COPAY-GRADE-BRANCH-MISSING — calc_copayment v1.6
--
-- ★ 정정: 차상위·의료급여 등급의 의원급(1차) 외래 본인부담을 정률(14%/15%)에서 정액/면제로 교정.
--    현행 v1.5 의 14%/15% 는 "날조"가 아니라 **입원·병원급 요율을 의원급 외래에 오적용**한 것.
--    foot = 의원급 1차 외래 → 정액/면제가 이 scope 의 정본 (DA 재확정 VERDICT=GO, 3자 대조 완료).
--
-- 재확정 요율 (의원급 1차 외래 scope, DA da_ratify_copayment_grade_rates_20260720):
--   · low_income_1 (차상위 희귀·중증난치·중증) : 14% → **0원 면제** (copay=0 전용분기 신설)  [별표2 3호 라목]
--   · low_income_2 (차상위 만성·18세미만)      : 14% → **정액 LEAST(1,000, base)**            [별표2 3호 라목]
--   · medical_aid_2 (의료급여 2종)             : 15% → **정액 LEAST(1,000, base)**            [의료급여법 별표1]
--   · medical_aid_1 (의료급여 1종)             : LEAST(1,000, base) — **유지 (기 정확)**       [의료급여법 별표1]
--   · general 30% / infant 21% / elderly 4구간 / foreigner 전액 : **유지 (회귀 0)**
--
-- 규정 근거 (조사관/주무관 소명용):
--   · 국민건강보험법 시행령 별표2 제3호 라목 (차상위 본인부담경감: 희귀·중증난치·중증 면제, 그 외 정액)
--   · 의료급여법 시행령 별표1 (의료급여 1·2종 의원 외래 정액 1,000원)
--   · HIRA 심평원 본인부담기준: 차상위경감(HIRAA030056020130), 의료급여(HIRAA030057020000)
--   · CIT-2026-001/002 (외래 본인부담 100원 미만 절사, FLOOR — 정률경로/elderly 유지)
--
-- 본 마이그레이션 델타 (v1.5=20260715150000 대비):
--   [RATE]   v_rate CASE: low_income_1 0.14→0.00, low_income_2 0.14→0.00, medical_aid_2 0.15→0.00.
--            (정액/면제 등급 applied_rate 는 정보성 — medical_aid_1(0.00) 관행과 통일. copay 는 분기가 정본.)
--   [BRANCH] low_income_1 → copay=0(면제) 전용분기 신설.
--   [BRANCH] 정액분기 IN 확장: medical_aid_1 → (medical_aid_1, low_income_2, medical_aid_2) LEAST(1000,base).
--   [무변경] elderly_flat 4구간(FLOOR)·general/infant/ELSE 정률경로(FLOOR v1.5)·hira_unit_value governed·
--            NULLFIX v1.2 default-deny·의료급여 1종 정액·비급여/외국인 전액경로 — 전부 유지(회귀 0).
--
-- ADDITIVE: CREATE OR REPLACE (시그니처·반환타입 7컬럼 동일, 파괴변경 아님). 멱등(재실행 안전).
--   기존 GRANT 보존되나 재확인 REVOKE/GRANT 포함. 트랜잭션 제어문(BEGIN/COMMIT) 미포함(dry-run no-persistence 준수).
-- 소급 = 범위 밖(forward-only). 기존 service_charges/payments 행 UPDATE 절대 금지.
--   (과거 오요율 적재분 backfill 필요 여부 = 별건 defer, cross_crm_data_correction_backfill_sop.)
-- ⚠ SCOPE CAVEAT: 정액/면제값 = 의원급(1차) 외래 전용. 타 CRM(병원급·입원) 재사용 금지.
-- rollback: 20260720193000_calc_copayment_grade_flat_exempt.rollback.sql (→ v1.5 정률 14%/15% 복원)

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

  -- ★[v1.6 RATE] 정액/면제 등급(low_income_1·2, medical_aid_1·2)의 rate = 0.00(정보성).
  --   실 copay 는 아래 분기가 정본. medical_aid_1(0.00) 관행과 통일. 종전 14%/15% = 병원급 오적용 정정.
  v_rate := CASE v_grade
    WHEN 'general' THEN 0.30
    WHEN 'low_income_1' THEN 0.00   -- v1.6: 면제 (was 0.14)
    WHEN 'low_income_2' THEN 0.00   -- v1.6: 정액 (was 0.14)
    WHEN 'medical_aid_1' THEN 0.00
    WHEN 'medical_aid_2' THEN 0.00  -- v1.6: 정액 (was 0.15)
    WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30
    ELSE 0.30
  END;

  IF v_service.copayment_rate_override IS NOT NULL THEN
    v_rate := v_service.copayment_rate_override;
  END IF;

  IF v_grade = 'low_income_1' THEN
    -- ★[v1.6 면제] 차상위 희귀·중증난치·중증 → 본인부담 전액 면제(0원). 시행령 별표2 3호 라목.
    --   copay=0 → 공단부담(covered)=base. override 무관(법정 면제 우선, medical_aid 패턴).
    v_copay := 0;
    v_covered := v_base;
    v_exempt := 0;

  ELSIF v_grade IN ('medical_aid_1', 'low_income_2', 'medical_aid_2') THEN
    -- ★[v1.6 정액] 의급 1·2종 / 차상위 만성·18세미만 → 의원 외래 정액 LEAST(1,000, 수가).
    --   (직접조제 1,500 edge 는 미대상.) 의료급여법 별표1 / 시행령 별표2 3호 라목. override 무관(정액 우선).
    v_copay := LEAST(1000, v_base);
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSIF v_grade = 'elderly_flat' AND v_service.copayment_rate_override IS NULL THEN
    -- ── [이슈2] 노인 외래 정률제 4구간 (의원급, §2-2-3) ─────────────────────────
    -- override 가 있으면 4구간 미적용(개별 실손 자기부담률 우선, ELSE 정률경로로 흡수).
    -- ★[ROUNDING] 정률구간 원단위 = 100원 미만 절사(FLOOR). 시행령 별표2 §19① "100원 미만 제외". (v1.4)
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
    -- ★[ROUNDING v1.5] 일반 정률경로(general/infant/unverified/ELSE): 100원 미만 절사(FLOOR).
    --   CIT-2026-001(시행령 별표2 §19① "100원 미만 제외") + CIT-2026-002(심평원 외래 100원미만 절사)
    --   = 외래 본인부담 전반 FLOOR. §2-2 v1.12 round-DOWN. (T-20260715 CEIL→FLOOR 정정 유지)
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

COMMENT ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE) IS
  '건보 본인부담 산출 v1.6 — 의원급 1차 외래 등급요율 교정: low_income_1 면제(0원 전용분기) / low_income_2·medical_aid_2 정액 LEAST(1000,base)(종전 14%/15% 병원급 오적용 정정) / medical_aid_1 정액 유지 / general 30%·infant 21%·elderly 4구간(FLOOR)·foreigner 전액 유지(회귀0). 정률경로/elderly 100원 미만 절사(CIT-2026-001/002). NULLFIX v1.2·hira_unit_value governed 유지. ⚠ 정액/면제값=의원급 1차 외래 전용, 타 CRM(병원급·입원) 재사용 금지. (T-20260720-foot-COPAY-GRADE-BRANCH-MISSING, DA GO)';

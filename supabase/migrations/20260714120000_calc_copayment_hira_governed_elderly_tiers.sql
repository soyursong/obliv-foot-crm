-- T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE — 이슈1(2/2)+이슈2: calc_copayment v1.3
--
-- SSOT: revenue_insurance_split_spec.md v1.10 §2-2-0(환산지수 governed) + §2-2-1(a/b) + §2-2-3(노인 4구간)
-- DA CONSULT-REPLY: MSG-20260713-234807-dz3j(조건부 GO) + MSG-20260714-012349-0p72(4구간 정본)
-- 종별: 의원급 확정. 점당단가 95.6·노인 외래 4구간 적용.
--
-- ⚠ REBASE ON NULLFIX(T-20260629-foot-COPAYCALC-SERVER-NULLFIX):
--   NULLFIX(20260629190000, v1.2 default-deny + data_incomplete)가 prod 에 미배포 상태
--   (schema_migrations 미기록 + prod RPC 6-col 반환 = v1.1 확인, 2026-07-14 probe).
--   → 이중패치 0 하드제약 준수: NULLFIX v1.2 로직을 본 마이그레이션이 흡수(subsume)하여
--     prod v1.1 → v1.3 을 단일 DROP+CREATE 로 승격. NULLFIX 마이그(20260629190000)는
--     독립 미적용(superseded-by 본 티켓) — planner/ledger 정합 필요(FOLLOWUP 통보).
--
-- 본 마이그레이션 델타(NULLFIX v1.2 대비):
--   [이슈1] hira_unit_value 숫자 fallback(COALESCE(...,89.4)) 전면 제거.
--           hira_unit_value IS NULL → data_incomplete=true BLOCK (§2-2-1b). 임의 상수 계산강행 금지.
--   [이슈2] elderly_flat 정액 단일분기(≤15,000=MIN(1500,base), 초과=30%) →
--           노인 외래 정률제 4구간(§2-2-3)으로 교체:
--             총진료비(base) ≤ 15,000        → 정액 1,500 (LEAST(1500,base) 가드)
--             15,000 초과 ~ 20,000 이하        → 10%
--             20,000 초과 ~ 25,000 이하        → 20%
--             25,000 초과                      → 30%
--           ★제보의 "3구간(15k~25k=20%)"은 오류 — 정본 4구간(15k~20k=10%).
--   정상분기 rounding: 기존/타 등급과 동일 100원 절상(CEIL/100*100) 유지.
--     ⚠ 노인 정률구간 원단위 처리(10원 절사 vs 100원 절상)는 NHIS 청구 관행 확인 pending →
--        코드베이스 일관성(타 등급=100원 절상) 잠정 적용. AC 테스트값(18k/22k/27k)은 rounding 무관 정확.
--
-- 소급 = 범위 밖(forward-only). 기존 service_charges/payments 행 UPDATE 절대 금지.
-- rollback: 20260714120000_calc_copayment_hira_governed_elderly_tiers.rollback.sql (→ NULLFIX v1.2 복원)

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
    IF v_base <= 15000 THEN
      v_copay := LEAST(1500, v_base);                      -- 정액 1,500
    ELSIF v_base <= 20000 THEN
      v_copay := CEIL((v_base * 0.10) / 100.0) * 100;      -- 10%
    ELSIF v_base <= 25000 THEN
      v_copay := CEIL((v_base * 0.20) / 100.0) * 100;      -- 20%
    ELSE
      v_copay := CEIL((v_base * 0.30) / 100.0) * 100;      -- 30%
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

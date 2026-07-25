-- T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY
-- 진찰료 시간외/공휴/토요일 30% 가산 → service_charges(명세) 영속 (Option B, going-forward, ADDITIVE).
--
-- DA Binding (da_decision_foot_surcharge_servicecharge_persist_policy_20260725.md, CONSULT-REPLY MSG-20260725-153357-r230):
--   정본 = revenue_insurance_split_spec.md §2-2-7(v1.21) + §2-2-4(grade NULL grain 분기) + §2-2-6(발행서류 covered_full 8차봉인).
--   verdict = Option B(going-forward 영속·ADDITIVE). '가산 covered 70% 신규 적재'가 아니라 명세가 참 진찰료 수가(base×1.3)를
--             반영하도록 완전화(명세 correctness). covered/copay split은 §2-2-4/§2-2-6 grade-keyed canon 그대로 상속.
--   parent write-path = T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT(record_insurance_consult_payment) — 확장 REUSE.
--
--   [AC-1 ★제약1 covered=grade-keyed] grade=null → 가산 covered=0(covered_full: 가산 수가는 본인=급여전액 흡수·공단 미표시).
--       가산 covered 70% 하드코딩 절대 금지(§2-2-4 판정2·§2-2-6 8차봉인 phantom NHIS 공단 날조 위배). grade-확정 general →
--       정상 §2-2 산식(가산 base×70%, 100원 미만 절사 §2-2 v1.12). capped × hira_score NULL → §2-2-1b BLOCK(data_incomplete).
--   [AC-2 제약2 권위 재사용 = 이중계상 가드] §2-2 기존 산출 권위(calc_copayment)에 가산 반영 base_amount(=base×(1+rate))를
--       입력 → split 을 1회 산출한다. 신규 30/70 인라인 경로 발명 금지(0722 canon-gate 조건1). 진찰료 시간외 가산은 진찰료 수가
--       자체를 올리는 것 → 가산 반영 수가 단일 산출(별도 가산 line 미신설, base_amount fold). 멱등 upsert(check_in+service+advisory
--       lock, calculation_engine_version v1/v2)로 재프린트·재정산 중복 방지.
--   [AC-3 제약3 대사 = grade-dependent] general → 가산 copay leg 가 payments(FK-copay)·service_charges 양측 일치(동일 calc_copayment
--       산출을 RPC 가 명세+수납 양쪽에 기록 → by construction 일치). grade=null → 수납(잠정 general 30% 가산 copay) vs 명세
--       (covered_full=본인전액, covered=0) divergence 는 §2-2-4 판정3 승인된 한시 pending 의 연장(신규 누출 아님).
--   [AC-4 ADDITIVE·going-forward] 기존 컬럼(base_amount/copayment_amount/insurance_covered_amount) fold — 신규 컬럼 0.
--       가산 marker 컬럼 미신설(base_amount fold 1순위, DA 권고). 함수 시그니처만 ADDITIVE 확장(p_surcharge_rate DEFAULT 0 →
--       기존 4/6-arg 호출은 default=0 로 byte-identical 회귀 0). going-forward only(기존 service_charges/payments 행 UPDATE 0건).
--
-- 게이트: DA GO + ADDITIVE + going-forward + 기존 컬럼 재사용 → §3.1 대표 게이트 면제, supervisor DDL-diff/QA만.
-- db_change = TRUE (함수 시그니처 ADDITIVE 확장 = 마이그 필수·prod apply 선행). MIG-GATE 4필드 대상.
-- Rollback: 20260725180000_foot_consultfee_surcharge_servicecharge_persist.rollback.sql (→ calc_copayment v1.6 / RPC v1 복원).
-- 재실행 안전: DROP FUNCTION IF EXISTS + CREATE. ⚠ Dry-Run No-Persistence Protocol: 본 파일 txn 제어문(BEGIN/COMMIT) 미포함.

-- ============================================================
-- 1) calc_copayment v1.7 — p_surcharge_rate DEFAULT 0 (ADDITIVE)
--    가산 반영 base = ROUND(hira_score × hira_unit_value × (1 + rate)). rate=0 → v1.6 과 byte-identical(회귀 0).
--    가산은 hira-scored 급여 정상분기에만 적용(비급여/foreigner/hira_score-NULL price-fallback 분기 무영향).
--    grade-keyed split(정률 FLOOR / 정액 LEAST / 면제 / elderly 4구간)은 가산 반영 base 위에서 그대로 = split 1회 산출(AC-2).
--    ⚠ 기존 4-arg 시그니처 DROP 후 5-arg(default) CREATE — 기존 positional/named 4-arg 호출은 default 로 resolve(단일 함수 유지).
-- ============================================================
DROP FUNCTION IF EXISTS calc_copayment(UUID, UUID, UUID, DATE);

CREATE FUNCTION calc_copayment(
  p_service_id UUID,
  p_customer_id UUID,
  p_clinic_id UUID,
  p_visit_date DATE DEFAULT CURRENT_DATE,
  p_surcharge_rate NUMERIC DEFAULT 0
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
  v_surcharge_rate NUMERIC;
BEGIN
  -- ★[v1.7] 가산 배수 clamp [0,1] — 음수·과대 배수 차단. 진찰료 시간외/공휴/토요 가산 canon = 0.30.
  v_surcharge_rate := GREATEST(0, LEAST(1, COALESCE(p_surcharge_rate, 0)));

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

  -- 비급여 또는 외국인 → 전액 본인부담 (정당한 비급여, data_incomplete=false). 가산 미적용(진찰료 급여 수가 개념 아님).
  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false;
    RETURN;
  END IF;

  -- ── 급여 + hira_score NULL 분기 (NULLFIX v1.2 default-deny, §2-2-1a) ────────
  --    가산 미적용(참 수가=hira_score 부재 → 가산 base 산출 불가, price-fallback 은 시간외가산 대상 아님).
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
  IF v_clinic.hira_unit_value IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;
    RETURN;
  END IF;

  -- ── 정상분기: hira_score + hira_unit_value 보유 급여건 ────────────────────────
  -- ★[v1.7 가산 fold] 가산 반영 base = ROUND(점수 × 점당단가 × (1 + 가산배수)). rate=0 → v1.6 과 동일(회귀 0).
  --   이 v_base 위에 아래 grade-keyed split 이 그대로 적용됨 = §2-2 산출 권위 재사용·split 1회 산출(AC-2).
  v_base := ROUND(v_service.hira_score * v_clinic.hira_unit_value * (1 + v_surcharge_rate));

  v_rate := CASE v_grade
    WHEN 'general' THEN 0.30
    WHEN 'low_income_1' THEN 0.00
    WHEN 'low_income_2' THEN 0.00
    WHEN 'medical_aid_1' THEN 0.00
    WHEN 'medical_aid_2' THEN 0.00
    WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30
    ELSE 0.30
  END;

  IF v_service.copayment_rate_override IS NOT NULL THEN
    v_rate := v_service.copayment_rate_override;
  END IF;

  IF v_grade = 'low_income_1' THEN
    -- 차상위 희귀·중증난치·중증 → 본인부담 전액 면제(0원). 시행령 별표2 3호 라목.
    v_copay := 0;
    v_covered := v_base;
    v_exempt := 0;

  ELSIF v_grade IN ('medical_aid_1', 'low_income_2', 'medical_aid_2') THEN
    -- 의급 1·2종 / 차상위 만성·18세미만 → 의원 외래 정액 LEAST(1,000, 수가).
    --   (가산 반영 base 여도 정액 cap 유지 = 가산분 전액 공단 흡수, grade-keyed canon.)
    v_copay := LEAST(1000, v_base);
    v_covered := v_base - v_copay;
    v_exempt := 0;

  ELSIF v_grade = 'elderly_flat' AND v_service.copayment_rate_override IS NULL THEN
    -- 노인 외래 정률제 4구간 (의원급, §2-2-3). 100원 미만 절사(FLOOR). 가산 반영 base 위에서 구간 판정.
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
    -- 일반 정률경로(general/infant/unverified/ELSE): 100원 미만 절사(FLOOR). CIT-2026-001/002·§2-2 v1.12 round-DOWN.
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

REVOKE ALL ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE, NUMERIC) TO authenticated;

COMMENT ON FUNCTION calc_copayment(UUID, UUID, UUID, DATE, NUMERIC) IS
  '건보 본인부담 산출 v1.7 — v1.6(등급요율 교정) + ★p_surcharge_rate DEFAULT 0(진찰료 시간외/공휴/토요 가산 fold). 가산 반영 base=ROUND(점수×점당단가×(1+rate)) 위에서 grade-keyed split 1회 산출(§2-2-7, AC-2). rate=0=v1.6 byte-identical(회귀 0). 가산은 hira-scored 급여 정상분기에만(price-fallback 무영향). ⚠ 정액/면제값=의원급 1차 외래 전용. (T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY, DA GO Option B)';

-- ============================================================
-- 2) record_insurance_consult_payment v2 — p_surcharge_rate DEFAULT 0 (ADDITIVE)
--    급여 진찰료 수납 원자 RPC 확장. 진찰료(hira_category='consultation') 급여건에만 가산 반영(이중계상 가드 =
--    진료비 전체합산 금지, 진찰료+가산코드 grain, body canon). calc_copayment(가산 rate) 단일권위 → 명세+FK-copay
--    양쪽에 동일 가산 반영 산출 기록(AC-3 general parity by construction). grade 미확정 → 명세 covered=0 보수(AC-1).
--    ⚠ 기존 6-arg 시그니처 DROP 후 7-arg(default) CREATE. calculation_engine_version → 'consult_writepath_v2'.
-- ============================================================
DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE);

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
  -- 결제수단 검증 (payments.method CHECK 와 동일 도메인)
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

  -- ── [AC-2 이중계상 가드] 가산은 진찰료(consultation) 급여건에만 반영. 처치/검사 등 타 카테고리는 rate=0(진료비
  --    전체합산 금지, 진찰료+가산코드 grain — body canon). 가산 대상 판정 SSOT(night/holiday/토요)는 FE detectSurchargeKind
  --    배포본이 소유하고 rate 로만 전달(병렬 재구현 금지) → 여기선 카테고리 gate + clamp 만.
  v_eff_rate := CASE
    WHEN v_service.hira_category = 'consultation'
      THEN GREATEST(0, LEAST(1, COALESCE(p_surcharge_rate, 0)))
    ELSE 0
  END;

  -- ── 멱등: 동일 (check_in, service) 급여 명세 + 링크 payment 동시 write race 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext(p_check_in_id::text || ':' || p_service_id::text));

  -- 이미 생성된 급여 명세 + 링크 payment 가 있으면 no-op(재시도/더블클릭/재프린트). v1·v2 양쪽 인식(deploy 경계 재시도 안전).
  SELECT sc.* INTO v_existing_sc
  FROM service_charges sc
  WHERE sc.check_in_id = p_check_in_id
    AND sc.service_id  = p_service_id
    AND sc.is_insurance_covered = TRUE
    AND sc.calculation_engine_version IN ('consult_writepath_v1', 'consult_writepath_v2')
  ORDER BY sc.calculated_at DESC
  LIMIT 1;

  IF v_existing_sc.id IS NOT NULL THEN
    SELECT p.id INTO v_existing_pay
    FROM payments p
    WHERE p.service_charge_id = v_existing_sc.id
    LIMIT 1;

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

  -- ── [AC-2] calc_copayment 단일권위 (가산 반영 base 입력 → split 1회 산출, 산식 재구현 금지, §2-2-7) ──
  SELECT * INTO v_calc
  FROM calc_copayment(p_service_id, p_customer_id, p_clinic_id, p_visit_date, v_eff_rate);

  -- ── [§2-2-1b] data_incomplete(hira_score NULL default-deny / hira_unit_value NULL) → BLOCK. 금액 날조 금지. ──
  IF v_calc.data_incomplete THEN
    RAISE EXCEPTION 'calc_copayment data_incomplete (service=%, grade=%) — 명세 생성 불가(§2-2-1b)',
      p_service_id, v_calc.applied_grade
      USING HINT = 'hira_score/hira_unit_value(clinics.hira_unit_value) 또는 자격등급 미비 확인';
  END IF;

  -- ── [AC-1] grade 미확정(unverified) → 명세 공단부담 확정 적재 금지(보수 0). 가산분 covered 도 함께 0(covered_full). ──
  --    수납 copay 는 calc_copayment 가 general_default(30%)로 반환한 가산 반영 값 그대로(잠정, 재정산 경로 전제, AC-3).
  v_grade_confirmed := (v_calc.applied_grade IS NOT NULL AND v_calc.applied_grade <> 'unverified');
  v_covered := CASE WHEN v_grade_confirmed THEN v_calc.insurance_covered_amount ELSE 0 END;

  -- ── [AC-2/AC-4] service_charges INSERT (base_amount = 가산 반영 참 수가, 기존 컬럼 fold — 신규 컬럼 0) ──
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

  -- ── [AC-3] payment INSERT: amount=copay(가산 반영, 공단분 수납 금지), tax_type NULL(=면세/VAT-exempt), FK link ──
  --    명세 copay 와 동일 calc_copayment 산출 → payments·service_charges 가산 copay leg 일치(general parity by construction).
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

COMMENT ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC) IS
  '급여 진찰료 수납 write-path v2 (T-20260725-foot-SURCHARGE-SERVICECHARGE-PERSIST-POLICY). v1 + p_surcharge_rate DEFAULT 0 → 진찰료(consultation) 급여건에만 시간외/공휴/토요 가산을 calc_copayment 가산 반영 base 로 fold(base_amount=base×(1+rate)). 명세+FK-copay 동일 산출 기록(§2-2-7 AC-3 general parity). grade 미확정→명세 covered=0 보수(AC-1). 기존 컬럼 fold·신규 컬럼 0(AC-4). rate=0 → v1 회귀 0. 멱등(check_in+service+advisory lock, engine v1/v2). going-forward only.';

-- T-20260819-foot-COPAY-VISIT-GRAIN — calc_visit_copayment (신규 ADDITIVE CREATE FUNCTION)
--
-- 결함: 본인부담금은 규정상 **방문(visit) 단위**인데 클라(calcCopaymentBatch=calc_copayment × N)·
--   수납 명세 write-path(snapshotCoveredServiceCharges)가 **항목당(item) 합산**한다.
--     · 의급 1·2종/차상위(정액 LEAST(1000,base)) → 항목마다 1,000원 = N항목 N,000원 과다징수(환자).
--     · 노인정액(4구간) → 항목별 구간판정 = 총액구간 오판(공단 과다청구).
--
-- 설계 = DA CONSULT-REPLY MSG-20260819-132529-kma1 (design A, ADDITIVE):
--   · calc_copayment(단건 정률 per-item 견적/표시)는 **in-place 무수정 존치**(caller 파손·회귀 방지).
--   · 신규 calc_visit_copayment 가 방문 grain **server AUTHORITY 재산출** — footBilling.fillBillItemCopayment
--     (:1015) 정확 mirror: 급여항목 base 를 방문총액으로 pool → 등급→copay 1회 → 비례배분+잔차.
--   · formula 발명 금지(§30-4/A10): 등급분기·요율·절사(FLOOR 100/노인4구간/의급 min(1000,총액))는
--     calc_copayment v1.7 verbatim 소비. grade=null/capped × 산출근거 미비 = §2-2-1a data_incomplete BLOCK
--     유지(phantom copay 금지) → 해당 항목 pool 미참여.
--   · sum-consistency = governing invariant (Σ copay = copayFromBase(grade, coveredSum)). per-item 배분은
--     내부분배(no regulatory 제약, DA C2). 잔차 tie-break = (소수부 desc, service_id asc, ord asc) 결정론
--     → iteration-order 비의존(멱등, DA C4). client redistributeVisitCopayment 와 byte-identical(DoD#4).
--
-- ADDITIVE·forward-only: 신규 함수 1개. 기존 함수/컬럼/행 무접촉. 소급 UPDATE 0(소급 정정=별건 BACKFILL).
--   db_change = TRUE (신규 CREATE FUNCTION = DDL). MIG-GATE 4필드 + 물리 GO-token 대상(DDL-0 아님).
--   재실행 안전: CREATE OR REPLACE (시그니처 고정). ⚠ Dry-Run No-Persistence: 본 파일 txn 제어문(BEGIN/COMMIT) 미포함.
-- rollback: 20260819200000_foot_calc_visit_copayment_additive.rollback.sql (→ DROP FUNCTION, 신규 오브젝트 제거).
-- ⚠ SCOPE CAVEAT: 정액/면제·노인4구간값 = 의원급(1차) 외래 전용. 타 CRM(병원급·입원) 재사용 금지.

CREATE OR REPLACE FUNCTION calc_visit_copayment(
  p_service_ids     UUID[],
  p_customer_id     UUID,
  p_clinic_id       UUID,
  p_visit_date      DATE DEFAULT CURRENT_DATE,
  p_surcharge_rate  NUMERIC DEFAULT 0
)
RETURNS TABLE(
  service_id                UUID,
  base_amount               INTEGER,
  insurance_covered_amount  INTEGER,
  copayment_amount          INTEGER,
  exempt_amount             INTEGER,
  applied_rate              NUMERIC,
  applied_grade             TEXT,
  data_incomplete           BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_customer       customers%ROWTYPE;
  v_clinic         clinics%ROWTYPE;
  v_svc            services%ROWTYPE;
  v_grade          TEXT;
  v_rate           NUMERIC;
  v_surcharge_rate NUMERIC;
  v_eff_rate       NUMERIC;
  v_base           INT;
  v_covered_sum    BIGINT := 0;
  v_copay_total    BIGINT := 0;
  v_allocated      BIGINT := 0;
  v_remainder      BIGINT;
  rec              RECORD;
BEGIN
  -- 가산 배수 clamp [0,1] (calc_copayment v1.7 와 동일). 진찰료(consultation) 급여건에만 적용.
  v_surcharge_rate := GREATEST(0, LEAST(1, COALESCE(p_surcharge_rate, 0)));

  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'customer not found: %', p_customer_id;
  END IF;
  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic_id;
  IF v_clinic.id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_id;
  END IF;

  v_grade := COALESCE(v_customer.insurance_grade, 'unverified');

  -- pool 요율(정보성 applied_rate). override 무시 = footBilling 집계 grain hasOverride=false 미러.
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

  -- 작업 집합(방문 항목 분류). txn-scoped, 세션 격리(RPC=1 txn).
  CREATE TEMP TABLE _vc_items (
    ord                       INT,
    service_id                UUID,
    base_amount               INT,
    copayment_amount          INT,
    insurance_covered_amount  INT,
    exempt_amount             INT,
    applied_rate              NUMERIC,
    applied_grade             TEXT,
    data_incomplete           BOOLEAN,
    poolable                  BOOLEAN
  ) ON COMMIT DROP;

  -- ── Pass 1: 항목별 base 산출 + 분류(calc_copayment v1.7 verbatim 분기) ─────────────────
  FOR rec IN
    SELECT u.sid, u.ord FROM unnest(p_service_ids) WITH ORDINALITY AS u(sid, ord)
  LOOP
    SELECT * INTO v_svc FROM services WHERE id = rec.sid;
    IF v_svc.id IS NULL THEN
      RAISE EXCEPTION 'service not found: %', rec.sid;
    END IF;

    -- 비급여/외국인 → 전액 본인부담(per-item, pool 미참여).
    IF NOT COALESCE(v_svc.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
      v_base := COALESCE(v_svc.price, 0);
      INSERT INTO _vc_items VALUES
        (rec.ord, rec.sid, v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false, false);
      CONTINUE;
    END IF;

    -- 급여 + hira_score NULL → general 정가 fallback / 그 외 default-deny BLOCK(§2-2-1a).
    IF v_svc.hira_score IS NULL THEN
      IF v_grade = 'general' THEN
        v_base := COALESCE(v_svc.price, 0);
        INSERT INTO _vc_items VALUES
          (rec.ord, rec.sid, v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false, false);
      ELSE
        INSERT INTO _vc_items VALUES
          (rec.ord, rec.sid, 0, 0, 0, 0, NULL::NUMERIC, v_grade, true, false);
      END IF;
      CONTINUE;
    END IF;

    -- 점당단가 governed NULL → BLOCK(§2-2-1b, 89.4 fallback 금지).
    IF v_clinic.hira_unit_value IS NULL THEN
      INSERT INTO _vc_items VALUES
        (rec.ord, rec.sid, 0, 0, 0, 0, NULL::NUMERIC, v_grade, true, false);
      CONTINUE;
    END IF;

    -- 정상 급여건 → poolable. 가산은 진찰료(consultation)에만(이중계상 가드, base_amount fold).
    v_eff_rate := CASE WHEN v_svc.hira_category = 'consultation' THEN v_surcharge_rate ELSE 0 END;
    v_base := ROUND(v_svc.hira_score * v_clinic.hira_unit_value * (1 + v_eff_rate));
    INSERT INTO _vc_items VALUES
      (rec.ord, rec.sid, v_base, NULL, NULL, 0, v_rate, v_grade, false, true);
  END LOOP;

  -- ── Pass 2: 방문 총액(coveredSum) 위에서 등급→copay 1회 산출(pool) ────────────────────
  SELECT COALESCE(SUM(base_amount), 0) INTO v_covered_sum FROM _vc_items WHERE poolable;

  IF v_covered_sum <= 0 THEN
    v_copay_total := 0;
  ELSIF v_grade = 'low_income_1' THEN
    v_copay_total := 0;                                             -- 면제
  ELSIF v_grade IN ('medical_aid_1', 'low_income_2', 'medical_aid_2') THEN
    v_copay_total := LEAST(1000, v_covered_sum);                    -- 정액(방문 총액 기준)
  ELSIF v_grade = 'elderly_flat' THEN
    IF v_covered_sum <= 15000 THEN
      v_copay_total := LEAST(1500, v_covered_sum);
    ELSIF v_covered_sum <= 20000 THEN
      v_copay_total := FLOOR((v_covered_sum * 0.10) / 100.0) * 100;
    ELSIF v_covered_sum <= 25000 THEN
      v_copay_total := FLOOR((v_covered_sum * 0.20) / 100.0) * 100;
    ELSE
      v_copay_total := FLOOR((v_covered_sum * 0.30) / 100.0) * 100;
    END IF;
    IF v_copay_total > v_covered_sum THEN v_copay_total := v_covered_sum; END IF;
  ELSE
    v_copay_total := FLOOR((v_covered_sum * v_rate) / 100.0) * 100;  -- general/infant/unverified/ELSE
    IF v_copay_total > v_covered_sum THEN v_copay_total := v_covered_sum; END IF;
  END IF;

  -- ── Pass 3: 비례배분 + 잔차보정(결정론 tie-break) ──────────────────────────────────────
  IF v_copay_total <= 0 THEN
    UPDATE _vc_items
      SET copayment_amount = 0, insurance_covered_amount = base_amount
      WHERE poolable;
  ELSE
    UPDATE _vc_items
      SET copayment_amount =
        LEAST(FLOOR(v_copay_total::NUMERIC * base_amount / v_covered_sum), base_amount)::INT
      WHERE poolable;

    SELECT COALESCE(SUM(copayment_amount), 0) INTO v_allocated FROM _vc_items WHERE poolable;
    v_remainder := v_copay_total - v_allocated;

    FOR rec IN
      SELECT ord,
             (v_copay_total::NUMERIC * base_amount / v_covered_sum)
               - FLOOR(v_copay_total::NUMERIC * base_amount / v_covered_sum) AS frac,
             base_amount - copayment_amount AS cap
      FROM _vc_items
      WHERE poolable
      ORDER BY frac DESC, service_id ASC, ord ASC
    LOOP
      EXIT WHEN v_remainder <= 0;
      IF rec.cap > 0 THEN
        UPDATE _vc_items
          SET copayment_amount = copayment_amount + LEAST(v_remainder, rec.cap)::INT
          WHERE ord = rec.ord;
        v_remainder := v_remainder - LEAST(v_remainder, rec.cap);
      END IF;
    END LOOP;

    UPDATE _vc_items
      SET insurance_covered_amount = base_amount - copayment_amount
      WHERE poolable;
  END IF;

  RETURN QUERY
    SELECT i.service_id, i.base_amount, i.insurance_covered_amount, i.copayment_amount,
           i.exempt_amount, i.applied_rate, i.applied_grade, i.data_incomplete
    FROM _vc_items i
    ORDER BY i.ord;
END;
$$;

REVOKE ALL ON FUNCTION calc_visit_copayment(UUID[], UUID, UUID, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calc_visit_copayment(UUID[], UUID, UUID, DATE, NUMERIC) TO authenticated;

COMMENT ON FUNCTION calc_visit_copayment(UUID[], UUID, UUID, DATE, NUMERIC) IS
  '건보 본인부담 방문(visit) grain 산출 — T-20260819-foot-COPAY-VISIT-GRAIN (DA design A, ADDITIVE). 급여항목 base 를 방문총액으로 pool → 등급→copay(calc_copayment v1.7 verbatim 분기: 의급/차상위 LEAST(1000,총액)·노인4구간·정률 FLOOR100·면제) 1회 → 비례배분+잔차(tie-break: 소수부 desc→service_id asc→ord asc, 멱등). 비급여/외국인/data_incomplete=pool 미참여(per-item·BLOCK 보존). sum-consistency=governing invariant. footBilling.fillBillItemCopayment mirror·client redistributeVisitCopayment byte-identical(DoD#4). ⚠ 의원급 1차 외래 전용, 타 CRM 재사용 금지.';

-- ============================================================
-- 2) record_insurance_consult_payment v3 — p_visit_service_ids UUID[] DEFAULT NULL (ADDITIVE)
--    급여 수납 원자 write-path 방문 grain 화. p_visit_service_ids 제공 시 이 방문의 급여항목 집합을
--    calc_visit_copayment(server AUTHORITY)로 pool → p_service_id 의 **방문 grain 배분 share** 를 적재
--    (per-item calc_copayment 대신). NULL(=기존 7-arg 호출) → v2 calc_copayment byte-identical(회귀 0).
--    ★ 재산출 단일권위 = calc_visit_copayment (money 축 client 값 blind 신뢰 금지, DA C4). 산식 재구현 금지.
--    ★ 멱등키 보존: (check_in, service) advisory lock + engine IN (v1/v2/v3). 루프 N회 호출이라도
--       calc_visit_copayment 는 PURE deterministic → 각 항목 share 합 = min(1000,총액)/구간총액(sum-consistency).
--    ⚠ 7-arg DROP 후 8-arg(default) CREATE. co-deploy 원자(calc_visit_copayment 와 동일 마이그).
-- ============================================================
DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC);

CREATE FUNCTION record_insurance_consult_payment(
  p_check_in_id UUID,
  p_customer_id UUID,
  p_clinic_id   UUID,
  p_service_id  UUID,
  p_method      TEXT,
  p_visit_date  DATE DEFAULT CURRENT_DATE,
  p_surcharge_rate NUMERIC DEFAULT 0,
  p_visit_service_ids UUID[] DEFAULT NULL
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
  v_engine          TEXT;
  v_visit_grain     BOOLEAN;
BEGIN
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

  -- 방문 grain 활성 판정(집합에 이 서비스가 포함돼야 유효). NULL/미포함 → 레거시 per-item(회귀 0).
  v_visit_grain := (p_visit_service_ids IS NOT NULL AND p_service_id = ANY(p_visit_service_ids));
  v_engine := CASE WHEN v_visit_grain THEN 'consult_writepath_v3' ELSE 'consult_writepath_v2' END;

  -- 가산은 진찰료(consultation) 급여건에만(이중계상 가드, base_amount fold). rate 로만 전달·clamp.
  v_eff_rate := CASE
    WHEN v_service.hira_category = 'consultation'
      THEN GREATEST(0, LEAST(1, COALESCE(p_surcharge_rate, 0)))
    ELSE 0
  END;

  -- 멱등: 동일 (check_in, service) 급여 명세 + 링크 payment 직렬화(race/더블클릭/재프린트 no-op).
  PERFORM pg_advisory_xact_lock(hashtext(p_check_in_id::text || ':' || p_service_id::text));

  SELECT sc.* INTO v_existing_sc
  FROM service_charges sc
  WHERE sc.check_in_id = p_check_in_id
    AND sc.service_id  = p_service_id
    AND sc.is_insurance_covered = TRUE
    AND sc.calculation_engine_version IN ('consult_writepath_v1','consult_writepath_v2','consult_writepath_v3')
  ORDER BY sc.calculated_at DESC
  LIMIT 1;

  IF v_existing_sc.id IS NOT NULL THEN
    SELECT p.id INTO v_existing_pay FROM payments p WHERE p.service_charge_id = v_existing_sc.id LIMIT 1;
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

  -- ── [DA C4] 재산출 단일권위 = calc_visit_copayment(방문 grain) 또는 calc_copayment(레거시 per-item) ──
  IF v_visit_grain THEN
    SELECT * INTO v_calc
    FROM calc_visit_copayment(p_visit_service_ids, p_customer_id, p_clinic_id, p_visit_date, p_surcharge_rate)
    WHERE service_id = p_service_id;
    IF v_calc IS NULL THEN
      RAISE EXCEPTION 'calc_visit_copayment returned no row for service % in visit set', p_service_id;
    END IF;
  ELSE
    SELECT * INTO v_calc
    FROM calc_copayment(p_service_id, p_customer_id, p_clinic_id, p_visit_date, v_eff_rate);
  END IF;

  -- ── [§2-2-1b] data_incomplete → BLOCK. 금액 날조 금지. ──
  IF v_calc.data_incomplete THEN
    RAISE EXCEPTION 'calc_copayment data_incomplete (service=%, grade=%) — 명세 생성 불가(§2-2-1b)',
      p_service_id, v_calc.applied_grade
      USING HINT = 'hira_score/hira_unit_value(clinics.hira_unit_value) 또는 자격등급 미비 확인';
  END IF;

  -- ── [AC-1] grade 미확정(unverified) → 명세 공단부담 확정 적재 금지(보수 0). ──
  v_grade_confirmed := (v_calc.applied_grade IS NOT NULL AND v_calc.applied_grade <> 'unverified');
  v_covered := CASE WHEN v_grade_confirmed THEN v_calc.insurance_covered_amount ELSE 0 END;

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
    v_engine
  )
  RETURNING id INTO v_sc_id;

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

REVOKE ALL ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID[]) TO authenticated;

COMMENT ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID[]) IS
  '급여 수납 write-path v3 (T-20260819-foot-COPAY-VISIT-GRAIN). v2 + p_visit_service_ids UUID[] DEFAULT NULL → 제공 시 calc_visit_copayment(server AUTHORITY)로 방문 grain pool 후 p_service_id 배분 share 적재(engine consult_writepath_v3). NULL=v2 calc_copayment byte-identical(회귀 0). 루프 N회라도 calc_visit_copayment PURE deterministic → share 합=min(1000,총액)/구간총액(sum-consistency, DoD#1). 멱등(check_in+service, engine v1/v2/v3). grade 미확정→covered=0 보수. ⚠ 의원급 1차 외래 전용.';

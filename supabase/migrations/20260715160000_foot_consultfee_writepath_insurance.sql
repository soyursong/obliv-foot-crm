-- T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT
-- 급여 진찰료(건강보험) 수납 write-path 보강 — service_charges 명세 행 생성 + 본인부담 payment + FK 링크.
--
-- DA Binding (DA-REPLY-T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT.md, GO ADDITIVE, going-forward 한정):
--   SSOT: revenue_insurance_split_spec.md §0(2 grain)·§2-1(v1.6 보험축=FK)·§2-2·§2-2-4(grade NULL grain별)·§2-5(v1.6 VAT축).
--   parent: T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX (read-side FIX) — 본 write-path와 직렬 의존.
--
--   [W1] service_charges 행: is_insurance_covered=TRUE, base/copay/covered 3값 = calc_copayment RPC 반환 그대로
--        (산식 재구현 금지·§2-2 단일권위). customer_grade_at_charge·hira_unit_value_year·check_in_id 필수.
--   [W2] payments.tax_type = §2-5 VAT축. 진찰료 급여 vat_type=none → 면세(exempt).
--        foot 물리 CHECK enum('과세_비급여','면세_비급여','급여','선수금')에 순수 'exempt' 없음 +
--        §2-1 "tax_type IS NULL → 면세(VAT) 보수 귀속" + §2-5 v1.6 "급여/비급여(보험축)는 tax_type 저장 안 함" →
--        canonical = tax_type NULL(=면세 default). tax_type='급여' 신설·기록 금지(보험축 중복저장 위반).
--        급여 귀속은 오직 service_charge_id FK → is_insurance_covered=TRUE 로만 판정.
--   [W3] service_charge INSERT + payment INSERT + FK set = 단일 서버 트랜잭션 RPC 원자화 + 멱등
--        (check_in_id+service_id 가드 + advisory lock 으로 더블클릭/재시도 race 방지). client 다중 write 금지.
--   [W4] FK = parent C4 canonical payments.service_charge_id nullable(신규 FK 만들지 말 것).
--        ADDITIVE: nullable·no-default·IF NOT EXISTS. 롤백 = DROP COLUMN. read(parent)/write(본 티켓) 동일 링크 공유.
--   [W5] insurance_grade NULL(=applied_grade 'unverified') 처리 grain별:
--        · 수납 payment  = general_default 30% 잠정 허용(calc_copayment 반환 copay 그대로, 재정산 경로 전제).
--        · 명세 service_charges = 공단 70% 확정 적재 금지 → insurance_covered_amount=0 보수 적재(phantom 공단 방지, §2-2-4 판정2).
--        hira_score NULL / hira_unit_value NULL = calc_copayment data_incomplete → BLOCK(EXCEPTION, 0/price 날조 금지, §2-2-1b).
--   [W6] 불변식: 수납 payment.amount == calc_copayment.copayment_amount(공단분 수납 금지, §0) — by construction.
--   [W7] going-forward 절대: 과거 진찰료 payments(F-4696·F-4702 포함) 재접촉 금지. 본 마이그레이션은 기존 행 UPDATE/재분류 0건.
--   [W9] sim 제외(§2-4-5)·is_deleted 돈 grain 미전파(§2-4) 준수 — 신규 service_charges 도 동일(현 sim=0 → no-op).
--
-- 게이트: supervisor DDL-diff (§3.1 대표 게이트 면제 — ADDITIVE + going-forward).
-- Rollback: 20260715160000_foot_consultfee_writepath_insurance.rollback.sql
-- 재실행 안전: ADD COLUMN IF NOT EXISTS + DROP/CREATE FUNCTION.
-- ⚠ Dry-Run No-Persistence Protocol: 본 파일에 txn 제어문(BEGIN/COMMIT) 미포함 — 러너가 외부 트랜잭션+ROLLBACK 로 무영속 리허설.

-- ============================================================
-- 1) [W4] payments.service_charge_id — parent C4 canonical nullable FK (재사용)
--    방향: payments.service_charge_id → service_charges.id. ADDITIVE·백필 불요·기존 행 무영향.
-- ============================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS service_charge_id UUID REFERENCES service_charges(id);

CREATE INDEX IF NOT EXISTS idx_payments_service_charge
  ON payments(service_charge_id) WHERE service_charge_id IS NOT NULL;

COMMENT ON COLUMN payments.service_charge_id IS
  '급여 명세 링크(parent C4 canonical) — 이 payment 가 커버하는 service_charges.id. NULL=비링크(비급여/수기 등). 급여 귀속 판정의 유일 축(§2-1 v1.6, tax_type 아님).';

-- ============================================================
-- 2) [W1] service_charges.hira_unit_value_year — 명세 시점 환산지수 연도 스냅샷 (필수 적재)
--    ADDITIVE nullable no-default. 기존 행 무영향(백필 불요).
-- ============================================================
ALTER TABLE service_charges
  ADD COLUMN IF NOT EXISTS hira_unit_value_year INT;

COMMENT ON COLUMN service_charges.hira_unit_value_year IS
  '명세 생성 시점 clinics.hira_unit_value_year 스냅샷 — EDI 재백필 방지(W1/W8).';

-- ============================================================
-- 3) [W3] record_insurance_consult_payment — 급여 진찰료 수납 원자 RPC (멱등)
--    service_charge INSERT + copay payment INSERT + FK set 을 단일 트랜잭션(함수)으로 묶는다.
--    calc_copayment 단일권위 호출(산식 재구현 0). grade-null grain별 처리(W5). tax_type NULL(W2).
-- ============================================================
DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE);

CREATE FUNCTION record_insurance_consult_payment(
  p_check_in_id UUID,
  p_customer_id UUID,
  p_clinic_id   UUID,
  p_service_id  UUID,
  p_method      TEXT,
  p_visit_date  DATE DEFAULT CURRENT_DATE
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
BEGIN
  -- 결제수단 검증 (payments.method CHECK 와 동일 도메인)
  IF p_method IS NULL OR p_method NOT IN ('card','cash','transfer','membership') THEN
    RAISE EXCEPTION 'invalid payment method: %', p_method;
  END IF;

  SELECT * INTO v_service FROM services WHERE id = p_service_id;
  IF v_service.id IS NULL THEN
    RAISE EXCEPTION 'service not found: %', p_service_id;
  END IF;
  -- 본 write-path 는 급여 항목 전용(비급여는 기존 plain payment 경로 유지).
  IF NOT COALESCE(v_service.is_insurance_covered, false) THEN
    RAISE EXCEPTION 'service % is not insurance-covered — consult write-path is 급여 only', p_service_id;
  END IF;

  -- ── [W3] 멱등: 동일 (check_in, service) 급여 명세 + 링크 payment 동시 write race 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext(p_check_in_id::text || ':' || p_service_id::text));

  -- 이미 생성된 급여 명세 + 링크된 payment 가 있으면 no-op(재시도/더블클릭).
  SELECT sc.* INTO v_existing_sc
  FROM service_charges sc
  WHERE sc.check_in_id = p_check_in_id
    AND sc.service_id  = p_service_id
    AND sc.is_insurance_covered = TRUE
    AND sc.calculation_engine_version = 'consult_writepath_v1'
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

  -- ── [W1] calc_copayment 단일권위 (산식 재구현 금지, §2-2) ──
  SELECT * INTO v_calc
  FROM calc_copayment(p_service_id, p_customer_id, p_clinic_id, p_visit_date);

  -- ── [W5/W1] data_incomplete(hira_score NULL default-deny / hira_unit_value NULL) → BLOCK. 금액 날조 금지. ──
  IF v_calc.data_incomplete THEN
    RAISE EXCEPTION 'calc_copayment data_incomplete (service=%, grade=%) — 명세 생성 불가(§2-2-1b)',
      p_service_id, v_calc.applied_grade
      USING HINT = 'hira_score/hira_unit_value(clinics.hira_unit_value) 또는 자격등급 미비 확인';
  END IF;

  -- ── [W5] grade 미확정(unverified) → 명세 공단부담 확정 적재 금지(보수 0). ──
  --    수납 copay 는 calc_copayment 가 general_default(30%)로 반환한 값 그대로 사용(잠정, 재정산 경로 전제).
  v_grade_confirmed := (v_calc.applied_grade IS NOT NULL AND v_calc.applied_grade <> 'unverified');
  v_covered := CASE WHEN v_grade_confirmed THEN v_calc.insurance_covered_amount ELSE 0 END;

  -- ── [W1] service_charges INSERT (calc_copayment 반환 전 필드 적재 — EDI 재백필 방지, W8) ──
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
    'consult_writepath_v1'
  )
  RETURNING id INTO v_sc_id;

  -- ── [W2/W4/W6] payment INSERT: amount=copay(공단분 수납 금지), tax_type NULL(=면세/VAT-exempt), FK link ──
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

REVOKE ALL ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE) TO authenticated;

COMMENT ON FUNCTION record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE) IS
  '급여 진찰료 수납 write-path (T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT). service_charge(is_insurance_covered=TRUE, calc_copayment 반환 적재) + copay payment(tax_type NULL=면세, service_charge_id FK) 원자 생성 + 멱등(check_in+service+advisory lock). grade NULL→명세 공단=0 보수/수납 30% 잠정(§2-2-4). going-forward only.';

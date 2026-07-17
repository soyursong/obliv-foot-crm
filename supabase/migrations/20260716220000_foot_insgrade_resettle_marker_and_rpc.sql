-- T-20260714-foot-INSGRADE-VERIFY-RESETTLE — Phase1 재정산 저장 스키마 + 재정산 RPC
--
-- SSOT: revenue_insurance_split_spec.md v1.13 §2-2-5 (신설, 재정산 경로 정본화)
--       · §2-2-4 · §2-2-1a/1b · §0 · §4 · data_correction_backfill_sop §0
-- DA CONSULT-REPLY: DA-REPLY-T-20260714-foot-INSGRADE-VERIFY-RESETTLE.md (GO 조건부, 2026-07-16 21:53)
--   판정1 = 제안A(payments 수납 grain) 채택 / 제안B(service_charges 스냅샷) 불채택.
--   판정2 = 명세 공단부담 0→확정 전환 = §2-2-1a 정합, calc_copayment 재호출 re-persist.
--   판정5 = capped 환수 = calc_copayment 권위 + ★BLOCK 게이트 + 불변식 환불액 ≤ 기징수액.
--
-- change-class = ADDITIVE (파괴 아님):
--   ① payments 신규 nullable 마커 컬럼 2개(resettle_reason CHECK allowlist governed-enum,
--      resettle_confirmed_grade) — 기존 행 무변경, 기존 INSERT 무영향.
--   ② 신규 함수 resettle_insurance_grade (신규만 추가, 기존 함수/enum/제약/타입 무변경).
--   기존 결제·환불·명세 경로 회귀 0.
--
-- ── 게이트 (DA 판정) ────────────────────────────────────────────────────────
--   · 마커 컬럼 DDL = ADDITIVE no-op → 대표 게이트 면제, supervisor DDL-diff(MIG-GATE 4필드)만.
--   · 실 refund(Layer2 MONEY, 원장 유출) = 대표·회계 게이트 + 총괄 confirm(money_gate).
--     → RPC 는 p_dry_run DEFAULT true. 실 commit(p_dry_run=false)은 money_gate 해제 후에만.
--   · 병렬 계산경로 신설 금지 — calc_copayment(수가 authority) 위에서만 산출.
--
-- ── 재정산 산식 (판정3·5, 결정성) ──────────────────────────────────────────
--   기징수(잠정 30%) 재구성 = Σ round100(수가 base × 0.30)  (parent PAYMINI general_default 미러)
--   확정 본인부담      = Σ calc_copayment(확정 등급).copayment_amount
--   차액 = 확정 − 기징수.  <0 → refund(과청구 환수)  / >0 → 추가징수  / =0 → 상태만 확정(시나리오2).
--   ★BLOCK: 확정 등급으로 어느 급여항목이든 data_incomplete=true(capped×hira_score/unit NULL)면
--           재정산 BLOCK·refund 금지 (추정 refund = 신규 역방향 오류).
--   불변식: 환불액 ≤ 기징수액  AND  환불액 ≤ 실수납액(paid_total) — over-refund 이중 차단.
--
-- Rollback: 20260716220000_foot_insgrade_resettle_marker_and_rpc.rollback.sql
-- Dry-run : 20260716220000_foot_insgrade_resettle_marker_and_rpc.dryrun.sql
-- author: dev-foot / 2026-07-16

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. payments 재정산 마커 컬럼 (ADDITIVE, nullable, CHECK allowlist governed-enum)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS resettle_reason         TEXT,   -- 재정산 사유 (일반 취소 refund 와 결정적 구분)
  ADD COLUMN IF NOT EXISTS resettle_confirmed_grade TEXT;  -- 재정산 시점 확정 등급 스냅샷(customer_grade_at_charge 미러)

-- CHECK allowlist(governed-enum) — free-form 금지. 신규 사유는 이 목록에만 추가.
DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_resettle_reason_allowlist'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_resettle_reason_allowlist
      CHECK (resettle_reason IS NULL OR resettle_reason IN ('insurance_grade_resettle'));
  END IF;
END $ck$;

CREATE INDEX IF NOT EXISTS idx_payments_resettle_reason
  ON payments (check_in_id) WHERE resettle_reason IS NOT NULL;

COMMENT ON COLUMN payments.resettle_reason IS
  '재정산 사유 마커(ADDITIVE, CHECK allowlist governed-enum). 등급확정 재정산 refund를 일반 취소 refund와 결정적 구분 → clawback 감사·A6 대사·capped 환수 추적. T-20260714-foot-INSGRADE-VERIFY-RESETTLE / SSOT §2-2-5';
COMMENT ON COLUMN payments.resettle_confirmed_grade IS
  '재정산 시점 확정 등급 스냅샷(immutability, customer_grade_at_charge 패턴 미러). T-20260714-foot-INSGRADE-VERIFY-RESETTLE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 재정산 RPC — resettle_insurance_grade
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION resettle_insurance_grade(
  p_check_in_id     UUID,
  p_confirmed_grade TEXT    DEFAULT NULL,  -- 검증용(전달 시 customers.insurance_grade 와 일치 강제)
  p_dry_run         BOOLEAN DEFAULT TRUE,  -- ★ 기본 dry-run. 실 commit 은 money_gate 해제 후 false.
  p_method          TEXT    DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci             check_ins%ROWTYPE;
  v_grade          TEXT;
  v_caller_clinic  UUID;
  v_visit_date     DATE;
  v_svc            RECORD;
  v_calc           RECORD;
  v_confirmed_copay  INTEGER := 0;
  v_provisional_copay INTEGER := 0;
  v_prov_row       INTEGER;
  v_blocked        BOOLEAN := FALSE;
  v_covered_cnt    INTEGER := 0;
  v_refund         INTEGER;
  v_additional     INTEGER;
  v_paid_total     INTEGER;
  v_refund_capped  INTEGER;
  v_orig_pay_id    UUID;
  v_existing_reset INTEGER;
  v_new_id         UUID;
BEGIN
  -- ── 권한 ──────────────────────────────────────────────────────────────────
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '재정산 권한이 없습니다.');
  END IF;

  -- ── 방문 조회 + clinic 격리 ────────────────────────────────────────────────
  SELECT * INTO v_ci FROM check_ins WHERE id = p_check_in_id;
  IF v_ci.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '방문(check-in)을 찾을 수 없습니다.');
  END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_ci.clinic_id IS NULL OR v_ci.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('ok', false, 'error', '해당 방문에 대한 재정산 권한이 없습니다.');
  END IF;
  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '고객이 지정되지 않은 방문은 재정산할 수 없습니다.');
  END IF;

  -- ── 확정 등급 = customers.insurance_grade (calc_copayment authority가 읽는 값) ─
  --   재정산은 등급이 이미 확정(수기 갱신 등)된 뒤에 호출된다(§2-2-4 endgame).
  SELECT insurance_grade INTO v_grade FROM customers WHERE id = v_ci.customer_id;
  IF v_grade IS NULL OR v_grade IN ('unverified', 'foreigner') THEN
    RETURN jsonb_build_object('ok', false, 'error', '자격등급이 확정되지 않았습니다(재정산 불가).', 'grade', v_grade);
  END IF;
  IF p_confirmed_grade IS NOT NULL AND p_confirmed_grade <> v_grade THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('전달 등급(%s)과 확정 등급(%s) 불일치 — 등급 저장 후 재시도.', p_confirmed_grade, v_grade));
  END IF;

  v_visit_date := (v_ci.created_at AT TIME ZONE 'Asia/Seoul')::date;

  -- ── 급여 서비스 집합 = 이 방문 service_charges(급여) 1차 권위, 없으면 check_in_services 폴백 ─
  --   결정성: persisted 스냅샷 우선. computeFootBilling 런타임 재산출 식별 금지(판정3).
  FOR v_svc IN
    SELECT DISTINCT service_id
    FROM service_charges
    WHERE check_in_id = p_check_in_id AND is_insurance_covered = TRUE
    UNION
    SELECT DISTINCT cis.service_id
    FROM check_in_services cis
    JOIN services s ON s.id = cis.service_id
    WHERE cis.check_in_id = p_check_in_id
      AND s.is_insurance_covered = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM service_charges sc
        WHERE sc.check_in_id = p_check_in_id AND sc.service_id = cis.service_id
      )
  LOOP
    -- calc_copayment(확정 등급) 재호출 — 수가 authority, 병렬 경로 금지
    SELECT * INTO v_calc
    FROM calc_copayment(v_svc.service_id, v_ci.customer_id, v_ci.clinic_id, v_visit_date);

    v_covered_cnt := v_covered_cnt + 1;
    IF COALESCE(v_calc.data_incomplete, false) THEN
      v_blocked := TRUE;   -- ★BLOCK 게이트: capped×hira_score/unit NULL → 재정산 BLOCK
      CONTINUE;
    END IF;

    v_confirmed_copay := v_confirmed_copay + COALESCE(v_calc.copayment_amount, 0);
    -- 기징수(잠정 30%) 재구성 = round100(base × 0.30), base 초과 cap (parent general_default 미러)
    v_prov_row := LEAST(CEIL((v_calc.base_amount * 0.30) / 100.0) * 100, v_calc.base_amount);
    v_provisional_copay := v_provisional_copay + v_prov_row;
  END LOOP;

  IF v_covered_cnt = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이 방문에 급여 항목이 없습니다(재정산 대상 아님).');
  END IF;

  -- ── ★BLOCK 게이트 (판정5): data_incomplete → refund 금지, 어떤 write 도 없음 ──
  IF v_blocked THEN
    RETURN jsonb_build_object(
      'ok', false, 'blocked', true, 'reason', 'data_incomplete',
      'error', '수가/정액 데이터 불완전(hira_score·환산지수·정액표 미접지) — 재정산 BLOCK. 데이터 확정 후 재시도.',
      'confirmed_grade', v_grade
    );
  END IF;

  -- ── 차액 산출 (판정5) ──────────────────────────────────────────────────────
  v_refund     := GREATEST(0, v_provisional_copay - v_confirmed_copay);  -- 과청구 환수
  v_additional := GREATEST(0, v_confirmed_copay - v_provisional_copay);  -- 과소징수 추가

  -- 실수납액(원 잠정 결제, 재정산분 제외) — 불변식 상한 소스
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
  FROM payments
  WHERE check_in_id = p_check_in_id
    AND payment_type = 'payment'
    AND resettle_reason IS NULL;

  -- 불변식: 환불액 ≤ 기징수액 AND ≤ 실수납액 (over-refund 이중 차단)
  v_refund_capped := LEAST(v_refund, v_provisional_copay, GREATEST(v_paid_total, 0));

  -- 원 잠정 결제행(refund 링크 대상) = 재정산분 아닌 최초 결제
  SELECT id INTO v_orig_pay_id
  FROM payments
  WHERE check_in_id = p_check_in_id
    AND payment_type = 'payment'
    AND resettle_reason IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  -- 멱등: 이미 재정산된 방문이면 재실행 차단(중복 환수 방지)
  SELECT COUNT(*) INTO v_existing_reset
  FROM payments
  WHERE check_in_id = p_check_in_id AND resettle_reason = 'insurance_grade_resettle';

  -- ── dry-run: 미리보기만 반환 (write 없음) ──────────────────────────────────
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true, 'blocked', false,
      'confirmed_grade', v_grade,
      'covered_count', v_covered_cnt,
      'confirmed_copay', v_confirmed_copay,
      'provisional_copay', v_provisional_copay,
      'refund', v_refund_capped,
      'additional', v_additional,
      'paid_total', v_paid_total,
      'already_resettled', (v_existing_reset > 0),
      'orig_payment_id', v_orig_pay_id
    );
  END IF;

  -- ── commit (p_dry_run=false) = Layer2 MONEY — money_gate 해제 후에만 호출 ────
  IF v_existing_reset > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 재정산된 방문입니다(중복 재정산 차단).',
      'confirmed_grade', v_grade);
  END IF;

  -- (a) 명세 공단부담 0→확정 re-persist (판정2, data_incomplete=false 확인 완료) ──
  --     covered service_charges 행을 확정 등급 산출값으로 갱신 + customer_grade_at_charge 스냅샷 확정.
  FOR v_svc IN
    SELECT DISTINCT service_id FROM service_charges
    WHERE check_in_id = p_check_in_id AND is_insurance_covered = TRUE
  LOOP
    SELECT * INTO v_calc
    FROM calc_copayment(v_svc.service_id, v_ci.customer_id, v_ci.clinic_id, v_visit_date);
    IF COALESCE(v_calc.data_incomplete, false) THEN
      CONTINUE;  -- BLOCK 위에서 걸러졌으나 방어적
    END IF;
    UPDATE service_charges
    SET base_amount              = v_calc.base_amount,
        insurance_covered_amount = v_calc.insurance_covered_amount,
        copayment_amount         = v_calc.copayment_amount,
        exempt_amount            = v_calc.exempt_amount,
        customer_grade_at_charge = v_grade,
        copayment_rate_at_charge = v_calc.applied_rate,
        calculation_engine_version = 'v1-resettle'
    WHERE check_in_id = p_check_in_id AND service_id = v_svc.service_id;
  END LOOP;

  -- (b) 돈-이동 payments 행 INSERT (판정1: 수납 grain, resettle_reason 마커, parent 링크) ─
  IF v_refund_capped > 0 THEN
    INSERT INTO payments (
      check_in_id, clinic_id, customer_id, amount, method, payment_type,
      parent_payment_id, tax_type, resettle_reason, resettle_confirmed_grade
    ) VALUES (
      p_check_in_id, v_ci.clinic_id, v_ci.customer_id, v_refund_capped, p_method, 'refund',
      v_orig_pay_id, '급여', 'insurance_grade_resettle', v_grade
    ) RETURNING id INTO v_new_id;
  ELSIF v_additional > 0 THEN
    INSERT INTO payments (
      check_in_id, clinic_id, customer_id, amount, method, payment_type,
      parent_payment_id, tax_type, resettle_reason, resettle_confirmed_grade
    ) VALUES (
      p_check_in_id, v_ci.clinic_id, v_ci.customer_id, v_additional, p_method, 'payment',
      v_orig_pay_id, '급여', 'insurance_grade_resettle', v_grade
    ) RETURNING id INTO v_new_id;
  END IF;
  -- refund=additional=0 (시나리오2 general): 돈-이동 없음, 명세만 pending→confirmed.

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false, 'committed', true, 'blocked', false,
    'confirmed_grade', v_grade,
    'covered_count', v_covered_cnt,
    'confirmed_copay', v_confirmed_copay,
    'provisional_copay', v_provisional_copay,
    'refund', v_refund_capped,
    'additional', v_additional,
    'resettle_payment_id', v_new_id
  );
END;
$$;

REVOKE ALL ON FUNCTION resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT) IS
  '건보 등급 확정 재정산(수납 grain refund/추가징수 + 명세 0→확정 re-persist). calc_copayment authority·병렬경로 금지·★data_incomplete BLOCK·불변식 환불액≤기징수액≤실수납액. p_dry_run DEFAULT true(commit=money_gate). T-20260714-foot-INSGRADE-VERIFY-RESETTLE / SSOT §2-2-5';

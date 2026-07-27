-- T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) — 재정산 '기징수(잠정 30%)' 재구성 CEIL→FLOOR 정합
--
-- ── 근본원인 (AC1) ──────────────────────────────────────────────────────────
--   현장(김주연 총괄, 풋센터) '등급 확정 재정산'에서 환불 예상 200원 오산정.
--   실제: 급여 자부담(30%) 화면표시=8,800원 / 기징수(잠정 30%)=8,900원 / 확정 본인부담=8,700원 →
--         환불 예상 = 8,900 − 8,700 = 200원 (오산정). 참값 = 8,800 − 8,700 = 100원.
--   RC: resettle_insurance_grade 의 기징수(잠정 30%) 재구성이 CEIL(절상, 100원 절상)로 계산되어
--       실제 잠정 청구액(FE copayFromBase general path = FLOOR, 100원 절사)과 100원 divergence.
--       base×0.30 = 8,812.5 → FLOOR=8,800(실 청구·화면표시) vs CEIL=8,900(RPC 재구성). 이 100원 차이가
--       환불 예상에 그대로 얹혀 200원(참값 100원)으로 부풀려짐.
--   → '등급 확정 재정산' 항목 자체는 정상 기능(확정등급 copay 8,700 < 실 잠정청구 8,800 → 실 100원 환수 존재).
--     오류는 항목 노출조건이 아니라 **기징수 재구성 산식(CEIL)** 이 ratified FLOOR canon 을 미추종한 drift.
--
-- ── 정정 ────────────────────────────────────────────────────────────────────
--   기징수(잠정 30%) 재구성을 CEIL → FLOOR 로 정정하여 copayFromBase 일반 정률경로(FLOOR, 100원 절사)와
--   완전 정합시킨다. 이 FLOOR 는 이미 ratified canon 이다:
--     · copayCalc.ts copayFromBase general path: Math.floor((base*rate)/100)*100  (v1.5)
--     · CIT-2026-001/002 외래 본인부담 전반 FLOOR (종전 CEIL 초과징수 정정)
--     · revenue_insurance_split_spec §2-2 v1.12
--   즉 본 정정은 SSOT 를 바꾸는 것이 아니라, resettle §2-2-5 재구성이 이미 확정된 FLOOR canon 을
--   따르도록 drift 를 되돌리는 **정합(alignment)** 이다. (line 154 주석 "parent PAYMINI general_default 미러"
--   의 의도대로 — 부모 PAYMINI 는 이미 FLOOR 로 이전됐는데 이 RPC 만 CEIL 잔존이었다.)
--
-- change-class = ADDITIVE-LOGIC (CREATE OR REPLACE, 스키마/컬럼/enum/타입/시그니처 무변경):
--   · 함수 body 1줄(CEIL→FLOOR)만 정정. 신규 컬럼·테이블·enum 없음 → §S2.4 DA CONSULT 게이트 비대상.
--   · 재구성값 ↓(8,900→8,800) → 환불액 ↓(200→100). 불변식(환불액 ≤ 기징수액 ≤ 실수납액) 유지·강화
--     (원장에 없는 돈을 만들지 않음 — over-refund 방향 축소, 환자·정산 안전).
--   · dry-run 미리보기 산식만 정정(실 refund commit=money_gate 별도). 기존 결제·환불·명세 경로 회귀 0.
--
-- ⚠ 금액(refund) 산식 정정 — DA-governed revenue_insurance_split_spec §2-2-5. ratified FLOOR canon 으로의
--    drift-fix 이므로 신규 정책 아님. supervisor prod-apply 前 planner→DA courtesy-ratify 권고(비차단).
--
-- Rollback: 20260727213000_foot_resettle_provisional_floor_align.rollback.sql (FLOOR→CEIL 복귀)
-- Dry-run : 20260727213000_foot_resettle_provisional_floor_align.dryrun.sql
-- base 원본: 20260716220000_foot_insgrade_resettle_marker_and_rpc.sql
-- author: dev-foot / 2026-07-27

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
    -- ── T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) [CEIL→FLOOR 정합] ────────────────────
    --   기징수(잠정 30%) 재구성 = round100(base × 0.30, **FLOOR** 100원 절사), base 초과 cap.
    --   ★FLOOR = ratified canon (copayFromBase general path v1.5 · CIT-2026-001/002 · revenue_insurance_split
    --     §2-2 v1.12). parent PAYMINI general_default 는 이미 FLOOR 이므로 그 실 잠정청구와 완전 정합
    --     (종전 CEIL = 실 청구보다 100원 과대 재구성 → 환불 예상 200원 오산정 RC). CEIL 복귀 금지.
    v_prov_row := LEAST(FLOOR((v_calc.base_amount * 0.30) / 100.0) * 100, v_calc.base_amount);
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
  '건보 등급 확정 재정산(수납 grain refund/추가징수 + 명세 0→확정 re-persist). 기징수(잠정 30%) 재구성=FLOOR(ratified canon 정합, T-20260727-2BUG 요건1 CEIL→FLOOR). calc_copayment authority·병렬경로 금지·★data_incomplete BLOCK·불변식 환불액≤기징수액≤실수납액. p_dry_run DEFAULT true(commit=money_gate). T-20260714-foot-INSGRADE-VERIFY-RESETTLE / SSOT §2-2-5';

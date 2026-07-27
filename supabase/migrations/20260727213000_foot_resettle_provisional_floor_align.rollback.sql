-- ROLLBACK — T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) 재정산 FLOOR→CEIL 복귀
--
-- 20260727213000_foot_resettle_provisional_floor_align.sql 을 되돌린다 = base 20260716220000 함수 본문 복원
-- (기징수 잠정 30% 재구성을 FLOOR → CEIL 로 되돌림). ⚠ 복원 시 환불 예상 200원 오산정(요건1 RC)이 재발한다 —
-- 회귀 확인용 비상 복귀 전용. 스키마/시그니처/컬럼/enum 무변경(함수 body 1줄 역전).

CREATE OR REPLACE FUNCTION resettle_insurance_grade(
  p_check_in_id     UUID,
  p_confirmed_grade TEXT    DEFAULT NULL,
  p_dry_run         BOOLEAN DEFAULT TRUE,
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
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '재정산 권한이 없습니다.');
  END IF;
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
  SELECT insurance_grade INTO v_grade FROM customers WHERE id = v_ci.customer_id;
  IF v_grade IS NULL OR v_grade IN ('unverified', 'foreigner') THEN
    RETURN jsonb_build_object('ok', false, 'error', '자격등급이 확정되지 않았습니다(재정산 불가).', 'grade', v_grade);
  END IF;
  IF p_confirmed_grade IS NOT NULL AND p_confirmed_grade <> v_grade THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('전달 등급(%s)과 확정 등급(%s) 불일치 — 등급 저장 후 재시도.', p_confirmed_grade, v_grade));
  END IF;
  v_visit_date := (v_ci.created_at AT TIME ZONE 'Asia/Seoul')::date;
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
    SELECT * INTO v_calc
    FROM calc_copayment(v_svc.service_id, v_ci.customer_id, v_ci.clinic_id, v_visit_date);
    v_covered_cnt := v_covered_cnt + 1;
    IF COALESCE(v_calc.data_incomplete, false) THEN
      v_blocked := TRUE;
      CONTINUE;
    END IF;
    v_confirmed_copay := v_confirmed_copay + COALESCE(v_calc.copayment_amount, 0);
    -- [ROLLBACK] 기징수 재구성 CEIL 복귀 (요건1 RC 재발 — 비상 전용)
    v_prov_row := LEAST(CEIL((v_calc.base_amount * 0.30) / 100.0) * 100, v_calc.base_amount);
    v_provisional_copay := v_provisional_copay + v_prov_row;
  END LOOP;
  IF v_covered_cnt = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이 방문에 급여 항목이 없습니다(재정산 대상 아님).');
  END IF;
  IF v_blocked THEN
    RETURN jsonb_build_object(
      'ok', false, 'blocked', true, 'reason', 'data_incomplete',
      'error', '수가/정액 데이터 불완전(hira_score·환산지수·정액표 미접지) — 재정산 BLOCK. 데이터 확정 후 재시도.',
      'confirmed_grade', v_grade
    );
  END IF;
  v_refund     := GREATEST(0, v_provisional_copay - v_confirmed_copay);
  v_additional := GREATEST(0, v_confirmed_copay - v_provisional_copay);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
  FROM payments
  WHERE check_in_id = p_check_in_id AND payment_type = 'payment' AND resettle_reason IS NULL;
  v_refund_capped := LEAST(v_refund, v_provisional_copay, GREATEST(v_paid_total, 0));
  SELECT id INTO v_orig_pay_id
  FROM payments
  WHERE check_in_id = p_check_in_id AND payment_type = 'payment' AND resettle_reason IS NULL
  ORDER BY created_at ASC LIMIT 1;
  SELECT COUNT(*) INTO v_existing_reset
  FROM payments
  WHERE check_in_id = p_check_in_id AND resettle_reason = 'insurance_grade_resettle';
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true, 'blocked', false,
      'confirmed_grade', v_grade, 'covered_count', v_covered_cnt,
      'confirmed_copay', v_confirmed_copay, 'provisional_copay', v_provisional_copay,
      'refund', v_refund_capped, 'additional', v_additional, 'paid_total', v_paid_total,
      'already_resettled', (v_existing_reset > 0), 'orig_payment_id', v_orig_pay_id
    );
  END IF;
  IF v_existing_reset > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 재정산된 방문입니다(중복 재정산 차단).', 'confirmed_grade', v_grade);
  END IF;
  FOR v_svc IN
    SELECT DISTINCT service_id FROM service_charges
    WHERE check_in_id = p_check_in_id AND is_insurance_covered = TRUE
  LOOP
    SELECT * INTO v_calc
    FROM calc_copayment(v_svc.service_id, v_ci.customer_id, v_ci.clinic_id, v_visit_date);
    IF COALESCE(v_calc.data_incomplete, false) THEN
      CONTINUE;
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
  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false, 'committed', true, 'blocked', false,
    'confirmed_grade', v_grade, 'covered_count', v_covered_cnt,
    'confirmed_copay', v_confirmed_copay, 'provisional_copay', v_provisional_copay,
    'refund', v_refund_capped, 'additional', v_additional, 'resettle_payment_id', v_new_id
  );
END;
$$;

REVOKE ALL ON FUNCTION resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

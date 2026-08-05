-- ROLLBACK: T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §1 (record_planb write-path)
-- 20260805171200_foot_record_planb_pkglink.sql 역연산.
--   record_planb_card_payment 를 직전 버전(20260802061500, checkin/single INSERT 에 package_id 미포함)
--   으로 복원. payments.package_id 링크만 사라짐(데이터 유실 0 — 링크 컬럼 미기록으로 회귀).

CREATE OR REPLACE FUNCTION public.record_planb_card_payment(
  p_clinic_id     uuid,
  p_raw_txid      uuid,
  p_attribution   text,
  p_customer_id   uuid,
  p_check_in_id   uuid        DEFAULT NULL,
  p_package_id    uuid        DEFAULT NULL,
  p_amount        integer     DEFAULT NULL,
  p_memo          text        DEFAULT NULL,
  p_source        text        DEFAULT 'auto',
  p_reconciled_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role   text := auth.role();
  v_uid    uuid := auth.uid();
  v_raw    redpay_raw_transactions%ROWTYPE;
  v_ci     check_ins%ROWTYPE;
  v_amount integer;
  v_revenue_at timestamptz;
  v_acct_date  date;
  v_merno  text;
  v_merno_in_foot boolean;
  v_match_rule text;
  v_pay_id uuid;
  v_pp_id  uuid;
  v_rows   int;
  v_cand_count int;
  v_cand_id uuid;
  v_existing uuid;
  v_total  integer;
BEGIN
  IF v_role IS NULL OR v_role = 'anon' THEN
    RAISE EXCEPTION 'unauthorized: anon/no-role' USING ERRCODE = '28000';
  END IF;
  IF v_role = 'authenticated' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'unauthorized: null uid' USING ERRCODE = '28000';
    END IF;
    PERFORM 1 FROM user_profiles up
      WHERE up.id = v_uid
        AND up.clinic_id = p_clinic_id
        AND COALESCE(up.active, true) = true
        AND up.role IN ('admin','manager','consultant','coordinator','therapist','technician');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'clinic_scope_denied: uid % not write-staff of clinic %', v_uid, p_clinic_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_attribution NOT IN ('checkin','single','package') THEN
    RAISE EXCEPTION 'invalid attribution: %', p_attribution;
  END IF;
  v_match_rule := CASE WHEN p_source = 'manual' THEN 'manual' ELSE 'tier0_direct' END;

  SELECT * INTO v_raw FROM redpay_raw_transactions WHERE id = p_raw_txid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'raw_not_found');
  END IF;
  IF v_raw.clinic_id <> p_clinic_id THEN
    RAISE EXCEPTION 'clinic_mismatch: raw.clinic_id % <> p_clinic_id %', v_raw.clinic_id, p_clinic_id
      USING ERRCODE = '42501';
  END IF;
  IF v_raw.external_status <> 'Y' THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'raw_not_approved');
  END IF;
  IF v_raw.matched_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'action', 'already_claimed', 'payment_id', v_raw.matched_payment_id);
  END IF;

  v_revenue_at := COALESCE(v_raw.approved_at, v_raw.received_at);
  IF v_revenue_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'no_revenue_anchor');
  END IF;
  v_acct_date := (v_revenue_at AT TIME ZONE 'Asia/Seoul')::date;
  v_amount := COALESCE(p_amount, v_raw.amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'invalid_amount');
  END IF;

  v_merno := v_raw.raw_payload->>'merchant';
  IF v_merno IS NOT NULL AND length(v_merno) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM redpay_terminal_registry r
       WHERE r.domain = 'foot' AND r.active
         AND (r.merchant_id = v_merno OR r.tid = v_merno
              OR v_merno = ANY (COALESCE(r.superseded_tids, ARRAY[]::text[])))
    ) INTO v_merno_in_foot;
    IF NOT v_merno_in_foot THEN
      RETURN jsonb_build_object('ok', false, 'action', 'cross_tenant_reject', 'alert', true, 'merno', v_merno);
    END IF;
  ELSE
    v_merno_in_foot := NULL;
  END IF;

  SELECT count(*), (array_agg(p.id))[1] INTO v_cand_count, v_cand_id
    FROM payments p
   WHERE p.payment_attempt_id IS NOT NULL
     AND p.clinic_id = p_clinic_id
     AND p.status = 'active' AND p.deleted_at IS NULL
     AND p.method = 'card'
     AND p.amount = v_amount
     AND p.accounting_date = v_acct_date
     AND p.reconciled_at IS NULL
     AND p.external_approval_no IS NOT DISTINCT FROM v_raw.approval_no
     AND EXISTS (SELECT 1 FROM redpay_terminal_registry r
                  WHERE r.domain = 'foot' AND r.active
                    AND (r.merchant_id = p.merchant_no OR r.tid = p.merchant_no))
     AND EXISTS (SELECT 1 FROM cband_payment_attempts a
                  WHERE a.id = p.payment_attempt_id
                    AND a.msg_trace IS NOT NULL AND a.clinic_id = p_clinic_id);

  IF v_cand_count >= 2 THEN
    RETURN jsonb_build_object('ok', true, 'action', 'tier4_manual', 'candidates', v_cand_count);
  ELSIF v_cand_count = 1 THEN
    UPDATE redpay_raw_transactions
       SET matched_payment_id = v_cand_id, match_rule = v_match_rule, updated_at = now()
     WHERE id = p_raw_txid AND matched_payment_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      SELECT matched_payment_id INTO v_existing FROM redpay_raw_transactions WHERE id = p_raw_txid;
      RETURN jsonb_build_object('ok', true, 'action', 'already_claimed', 'payment_id', v_existing);
    END IF;
    UPDATE payments
       SET reconciled_at   = COALESCE(reconciled_at, p_reconciled_at),
           external_trxid  = COALESCE(external_trxid, v_raw.external_trxid),
           external_tid    = COALESCE(external_tid, v_raw.tid),
           external_status = COALESCE(external_status, v_raw.external_status)
     WHERE id = v_cand_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'absorb write-fail: reconciled_at set rows=% (expected 1)', v_rows;
    END IF;
    RETURN jsonb_build_object('ok', true, 'action', 'absorbed',
                              'payment_id', v_cand_id, 'accounting_date', v_acct_date);
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id required (orphan payment 금지)';
  END IF;

  IF p_attribution = 'package' THEN
    IF p_package_id IS NULL THEN RAISE EXCEPTION 'package_id required for package attribution'; END IF;
    PERFORM 1 FROM package_payments
      WHERE package_id = p_package_id
        AND external_approval_no IS NOT DISTINCT FROM v_raw.approval_no
        AND external_tid IS NOT DISTINCT FROM v_raw.tid
        AND amount = v_amount;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'action', 'already_recorded_package');
    END IF;
    INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, installment,
                                  payment_type, fee_kind, memo, created_at, accounting_date,
                                  external_approval_no, external_tid)
    VALUES (p_clinic_id, p_package_id, p_customer_id, v_amount, 'card', 0,
            'payment', 'package', COALESCE(p_memo, '레드페이 자동수납(패키지 잔금)'),
            v_revenue_at, v_acct_date, v_raw.approval_no, v_raw.tid)
    RETURNING id INTO v_pp_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'package_payments insert rows=% (expected 1)', v_rows; END IF;
    SELECT COALESCE(sum(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END), 0)
      INTO v_total FROM package_payments WHERE package_id = p_package_id;
    UPDATE packages SET paid_amount = v_total, updated_at = now() WHERE id = p_package_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'packages paid_amount update rows=% (expected 1)', v_rows; END IF;
    RETURN jsonb_build_object('ok', true, 'action', 'created_package',
                              'package_payment_id', v_pp_id, 'accounting_date', v_acct_date);
  END IF;

  IF p_attribution = 'checkin' AND p_check_in_id IS NULL THEN
    RAISE EXCEPTION 'check_in_id required for checkin attribution (orphan 금지)';
  END IF;

  v_pay_id := gen_random_uuid();
  INSERT INTO payments (id, clinic_id, check_in_id, customer_id, amount, method, installment,
                        payment_type, memo, created_at, accounting_date, status,
                        external_trxid, external_approval_no, external_tid, external_status,
                        reconciled_at)
  VALUES (v_pay_id, p_clinic_id,
          CASE WHEN p_attribution = 'checkin' THEN p_check_in_id ELSE NULL END,
          p_customer_id, v_amount, 'card', 0, 'payment',
          COALESCE(p_memo, CASE WHEN p_attribution = 'checkin'
                                THEN '레드페이 자동수납(플랜B)' ELSE '레드페이 수납(단건)' END),
          v_revenue_at, v_acct_date, 'active',
          v_raw.external_trxid, v_raw.approval_no, v_raw.tid, v_raw.external_status,
          p_reconciled_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'payments insert rows=% (expected 1)', v_rows; END IF;

  UPDATE redpay_raw_transactions
     SET matched_payment_id = v_pay_id, match_rule = v_match_rule, updated_at = now()
   WHERE id = p_raw_txid AND matched_payment_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'raw claim race: matched_payment_id already set for raw % (rows=%)', p_raw_txid, v_rows;
  END IF;

  IF p_attribution = 'checkin' THEN
    SELECT * INTO v_ci FROM check_ins WHERE id = p_check_in_id FOR UPDATE;
    IF FOUND AND v_ci.status = 'payment_waiting' THEN
      UPDATE check_ins SET status = 'done' WHERE id = p_check_in_id;
      INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
      VALUES (p_check_in_id, p_clinic_id, v_ci.status, 'done', COALESCE(v_uid::text, 'redpay-planb-auto'));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', 'created', 'payment_id', v_pay_id,
                            'route', p_attribution, 'accounting_date', v_acct_date,
                            'merno_in_foot', v_merno_in_foot);
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) TO authenticated, service_role;

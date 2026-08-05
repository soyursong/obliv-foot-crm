-- ════════════════════════════════════════════════════════════════════════════
-- T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §1 (record_planb write-path)
--   record_planb_card_payment checkin/single 분기 payments INSERT 에 package_id 스레딩.
--
-- SSOT: DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX / HARD census C2 (commit 07941264).
--
-- ── 변경 (유일 diff) ────────────────────────────────────────────────────────
--   §5-b checkin/single payments INSERT 에 `package_id = p_package_id` 추가.
--   기존 param p_package_id(旣존재, 지금까지 'package' 분기에서만 사용)를 checkin/single
--   payments 착지에도 링크 → 결제수단-변경 재결제가 원장②(payments)에 착지할 때 원천 package
--   컨텍스트를 보존(§2 cross-ledger status 트리거 가시화). p_package_id 미지정(NULL) 시 종전 동작.
--   ⛔ 미러 payment auto-create 아님 — 기존 INSERT 1행에 link 컬럼만 세팅(VG3 guess-match 금지).
--
-- ── 무변경 불변식 (전부 보존) ────────────────────────────────────────────────
--   SECDEF seal(search_path·clinic-scope 재검증·grant) · absorb-guard(K5 CAT-origin 5조건) ·
--   MERNO tenant-isolation · raw-row 원자 claim 멱등 · 매출앵커(accounting_date) · rows-affected
--   assert · package 분기 · 반환 payload. 시그니처 무변경(param 동일 10개).
--
-- change-class: CREATE OR REPLACE FUNCTION(payments INSERT 1컬럼 추가) → function-diff.
--   ADDITIVE(payments.package_id 旣존재 nullable FK 컬럼에 write only, 스키마/매출 무접촉).
--
-- Rollback = 20260805171200_foot_record_planb_pkglink.rollback.sql (20260802061500 버전 복원).
-- author: dev-foot / 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_planb_card_payment(
  p_clinic_id     uuid,
  p_raw_txid      uuid,
  p_attribution   text,                          -- 'checkin' | 'single' | 'package'
  p_customer_id   uuid,
  p_check_in_id   uuid        DEFAULT NULL,       -- required for 'checkin'
  p_package_id    uuid        DEFAULT NULL,       -- required for 'package'; checkin/single 시 선택 링크
  p_amount        integer     DEFAULT NULL,       -- override; default = raw.amount
  p_memo          text        DEFAULT NULL,
  p_source        text        DEFAULT 'auto',     -- 'auto'(EF matchPass) | 'manual'(FE 수동매칭)
  p_reconciled_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
-- REVTRANSITION-FWDFIX-PKGLINK: checkin/single payments INSERT 에 package_id 링크(§1).
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
  -- ── 0. 인증 · clinic-scope 재검증 (SECDEF RLS 우회 보정) ────────────────────────
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
  -- service_role(EF matchPass) = 내부 신뢰 워커. clinic scope 는 아래 raw 교차검증으로 하위 강제.

  IF p_attribution NOT IN ('checkin','single','package') THEN
    RAISE EXCEPTION 'invalid attribution: %', p_attribution;
  END IF;
  v_match_rule := CASE WHEN p_source = 'manual' THEN 'manual' ELSE 'tier0_direct' END;

  -- ── 1. raw 로드 + row lock(동시성 직렬화점) ──────────────────────────────────────
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
  -- 멱등: 이미 claim 된 raw → no-op (기존 matched_payment_id 반환)
  IF v_raw.matched_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'action', 'already_claimed', 'payment_id', v_raw.matched_payment_id);
  END IF;

  -- ── 2. 매출-일자 앵커 = approved_at → Asia/Seoul 달력일(INSERT/감지 시각 금지) ──────
  v_revenue_at := COALESCE(v_raw.approved_at, v_raw.received_at);
  IF v_revenue_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'no_revenue_anchor');
  END IF;
  v_acct_date := (v_revenue_at AT TIME ZONE 'Asia/Seoul')::date;
  v_amount := COALESCE(p_amount, v_raw.amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'message', 'invalid_amount');
  END IF;

  -- ── 3. MERNO cross-tenant 격리 (redpay_terminal_registry foot allowlist) ──────────
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

  -- ── 4. absorb-guard (K5 CAT-origin 흡수, 신규 INSERT skip) — §5 ADDENDUM 5조건 ──────
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

  -- ── 5. 신규 결제기록 (absorb 후보 0) ──────────────────────────────────────────────
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id required (orphan payment 금지)';
  END IF;

  -- ── 5-a. package branch — package_payments(canonical) + paid_amount 재집계 ──────────
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

  -- ── 5-b. checkin / single — payments INSERT → raw claim (INSERT-first, FK 충족) ──────
  IF p_attribution = 'checkin' AND p_check_in_id IS NULL THEN
    RAISE EXCEPTION 'check_in_id required for checkin attribution (orphan 금지)';
  END IF;

  v_pay_id := gen_random_uuid();
  -- §1 PKGLINK: package 관련 재결제가 checkin/single 로 착지할 때 p_package_id(원천 컨텍스트) 링크.
  --   p_package_id 미지정 시 NULL(종전 동작). 미러 auto-create 아님 — 단일 INSERT 에 link 컬럼만.
  INSERT INTO payments (id, clinic_id, check_in_id, package_id, customer_id, amount, method, installment,
                        payment_type, memo, created_at, accounting_date, status,
                        external_trxid, external_approval_no, external_tid, external_status,
                        reconciled_at)
  VALUES (v_pay_id, p_clinic_id,
          CASE WHEN p_attribution = 'checkin' THEN p_check_in_id ELSE NULL END,
          p_package_id,
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

  -- checkin 칸반 해소: payment_waiting → done + status_transitions (best-effort, 결제는 유지)
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

-- ── grant seal (A7 anon-EXEC baseline 불변 — 신규 anon 도입 0) ──────────────────────
REVOKE ALL ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_planb_card_payment(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,timestamptz) IS
  'REDPAY PlanB 카드결제 단일 정본 write-path. FE 경로B + EF 경로A 수렴(single-writer). absorb-guard(K5 CAT-origin)·MERNO tenant-isolation·raw-row 원자 claim 멱등. checkin/single payments INSERT 에 package_id 링크(§1 REVTRANSITION-FWDFIX). SSOT=DA-20260802-FOOT-REDPAY-PLANB-SINGLE-RPC-ABSORB-GUARD + DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX.';

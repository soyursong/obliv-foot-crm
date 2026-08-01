-- T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK — single RPC record_planb_card_payment 신설
--   SSOT: da_consult_reply_foot_redpay_planb_single_rpc_absorb_guard_20260802.md
--         (DA-20260802-FOOT-REDPAY-PLANB-SINGLE-RPC-ABSORB-GUARD, Q1=ADDITIVE GO / Q2=§5 ADDENDUM)
--
-- change-class = ADDITIVE (CREATE FUNCTION = 신규 함수객체 1개 추가 only).
--   기존 payments/payment_items/package_payments/packages/check_ins/status_transitions/
--   redpay_raw_transactions 스키마(컬럼·제약·enum·RLS) 무접촉. rollback = DROP FUNCTION(회귀 0).
--
-- 역할 = 레드페이 플랜B 카드결제의 단일 정본 write-path(single-writer 수렴, opt3 §7 ADDENDUM (a) 이행):
--   · FE 경로B(수납 인라인 클로저) + EF 경로A(auto-record matchPass)가 이 RPC 1벌을 호출
--     → 두 발산 코드경로 소멸(dual-writer race 해소, AC7 by-construction shape-parity).
--   · shape-parity 기준점 = src/lib/manualPaymentWritePath.ts recordManualPayment (checkin/single/package).
--
-- foot-native 필드계약 (§788 verify-before-assert · prod 실측 2026-08-02):
--   · method='card' 고정 — pg_provider/method_standard/paid_at write 없음(foot prod 부재 컬럼 실측 확인).
--   · redpay-sourced 판별자 = external_trxid NOT NULL(raw 에서 populate).
--   · 매출-일자 앵커 = accounting_date = raw.approved_at 의 Asia/Seoul 달력일(명시 set → INSERT 시각 트리거
--     drift 차단). created_at = approved_at(Closing 일자집계 정합).
--   · check_in_id 결속 필수(checkin) / orphan payment 금지.
--   · 멱등 = raw-row 원자 claim(matched_payment_id IS NULL WHERE rows=1, else already_claimed).
--
-- SECURITY DEFINER seal (supervisor PHI DB-GATE 대상):
--   · search_path 핀 = public, pg_temp.
--   · clinic-scope 재검증(RLS 우회 보정): authenticated → user_profiles 소속·write role 확인(RLS 등가) / anon 거부 /
--     service_role(EF) → 내부 신뢰 워커, p_clinic_id 로 raw 교차검증.
--   · grant seal: REVOKE PUBLIC/anon · GRANT authenticated, service_role.
--   · 각 내부 write rows-affected assert(INV-W2/W5 — 0-row+error=null 성공오판 차단).
--
-- absorb-guard (K5 CAT-origin 흡수 · §5 ADDENDUM 5조건 + MERNO tenant-isolation + MSG_TRACE belt):
--   신규 payments INSERT 직전, 동일 승인건이 이미 코밴 CAT 직결 결제(payment_attempt_id NOT NULL)로
--   존재하면 그 payment 에 reconciled_at set + raw claim + INSERT skip(매출 double-count 0).
--   ① composite: amount ∧ card ∧ same-KST-day(accounting_date) ∧ external_approval_no corroborator
--   ② CAT scope: payment_attempt_id IS NOT NULL(PRIMARY) + MSG_TRACE(cband_payment_attempts) join belt
--   ③ multi-candidate(≥2) → tier4_manual(blind auto-absorb 금지)
--   ④ forward/same-KST-day(accounting_date 동일)
--   ⑤ count-grain 불변: reconciled_at set only(행접기/DISTINCT 금지) + raw matched_payment_id only
--   + MERNO cross-tenant 격리: 후보 merchant_no ∈ redpay_terminal_registry(domain=foot, active).
--   + backlog-safe: 활성 순간 누적 backlog 피드행도 동일 absorb 술어 경유 → 소급 double-count 0.

CREATE OR REPLACE FUNCTION public.record_planb_card_payment(
  p_clinic_id     uuid,
  p_raw_txid      uuid,
  p_attribution   text,                          -- 'checkin' | 'single' | 'package'
  p_customer_id   uuid,
  p_check_in_id   uuid        DEFAULT NULL,       -- required for 'checkin'
  p_package_id    uuid        DEFAULT NULL,       -- required for 'package'
  p_amount        integer     DEFAULT NULL,       -- override; default = raw.amount
  p_memo          text        DEFAULT NULL,
  p_source        text        DEFAULT 'auto',     -- 'auto'(EF matchPass) | 'manual'(FE 수동매칭)
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
  -- ── 0. 인증 · clinic-scope 재검증 (SECDEF RLS 우회 보정) ────────────────────────
  IF v_role IS NULL OR v_role = 'anon' THEN
    RAISE EXCEPTION 'unauthorized: anon/no-role' USING ERRCODE = '28000';
  END IF;
  IF v_role = 'authenticated' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'unauthorized: null uid' USING ERRCODE = '28000';
    END IF;
    -- 권위 role 소스 = user_profiles(RLS current_user_role()/current_user_clinic_id() 와 동일).
    --   staff 테이블 아님 — payments RLS(payments_admin_all/consult/coord/therap_insert)가 전부
    --   user_profiles.role 기반(admin/manager/consultant/coordinator/therapist/technician 가 결제 write).
    --   staff.role CHECK 는 director/consultant/coordinator/therapist/technician 로 admin/manager 부재 →
    --   staff 로 검증 시 admin/manager 계정(staff 행 없을 수 있음) false-deny. user_profiles 로 RLS 등가 재현.
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
      -- foot 단말 아님 = cross-tenant → absorb 대상 아님 + INSERT 차단(A11/A12 alert). fail-closed.
      RETURN jsonb_build_object('ok', false, 'action', 'cross_tenant_reject', 'alert', true, 'merno', v_merno);
    END IF;
  ELSE
    v_merno_in_foot := NULL;   -- 판별 불가(raw_payload.merchant 결손) — reject 안 함(데이터 결손, 관측만)
  END IF;

  -- ── 4. absorb-guard (K5 CAT-origin 흡수, 신규 INSERT skip) — §5 ADDENDUM 5조건 ──────
  --   host = payments 실제 INSERT 지점(auto-create 분기 내부, pending_payment 전이 스텝 아님).
  SELECT count(*), (array_agg(p.id))[1] INTO v_cand_count, v_cand_id
    FROM payments p
   WHERE p.payment_attempt_id IS NOT NULL                              -- ② CAT-origin scope(PRIMARY)
     AND p.clinic_id = p_clinic_id
     AND p.status = 'active' AND p.deleted_at IS NULL
     AND p.method = 'card'                                             -- ① card leg
     AND p.amount = v_amount                                          -- ① TAMT
     AND p.accounting_date = v_acct_date                             -- ①④ same-KST-day / forward
     AND p.reconciled_at IS NULL                                     -- 미대사만
     AND p.external_approval_no IS NOT DISTINCT FROM v_raw.approval_no  -- ① AUTHNO corroborator(composite leg, sole-key 금지)
     AND EXISTS (SELECT 1 FROM redpay_terminal_registry r             -- MERNO tenant-isolation
                  WHERE r.domain = 'foot' AND r.active
                    AND (r.merchant_id = p.merchant_no OR r.tid = p.merchant_no))
     AND EXISTS (SELECT 1 FROM cband_payment_attempts a               -- ② MSG_TRACE belt(1:1 by-construction)
                  WHERE a.id = p.payment_attempt_id
                    AND a.msg_trace IS NOT NULL AND a.clinic_id = p_clinic_id);

  IF v_cand_count >= 2 THEN
    -- ③ multi-candidate → blind auto-absorb 금지 → tier4_manual (claim/insert 안 함)
    RETURN jsonb_build_object('ok', true, 'action', 'tier4_manual', 'candidates', v_cand_count);
  ELSIF v_cand_count = 1 THEN
    -- absorb: 기존 CAT payment 에 reconciled_at set + raw claim + INSERT skip (⑤ count-grain 불변)
    UPDATE redpay_raw_transactions
       SET matched_payment_id = v_cand_id, match_rule = v_match_rule, updated_at = now()
     WHERE id = p_raw_txid AND matched_payment_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN   -- 동시 claim 경합 → 이미 claim 됨(멱등)
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
  --   payments 를 만들지 않음(package 매출 = package_payments). raw FK(→payments) 미충족이므로
  --   멱등은 package_payments dedup(external_approval_no+tid+amount), raw claim skip.
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
    -- created_by 미설정 = recordManualPayment package 분기 parity(FK user_profiles 리스크 회피).
    INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, installment,
                                  payment_type, fee_kind, memo, created_at, accounting_date,
                                  external_approval_no, external_tid)
    VALUES (p_clinic_id, p_package_id, p_customer_id, v_amount, 'card', 0,
            'payment', 'package', COALESCE(p_memo, '레드페이 자동수납(패키지 잔금)'),
            v_revenue_at, v_acct_date, v_raw.approval_no, v_raw.tid)
    RETURNING id INTO v_pp_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'package_payments insert rows=% (expected 1)', v_rows; END IF;
    -- paid_amount 재집계 (recordManualPayment package 분기 동일 산식)
    SELECT COALESCE(sum(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END), 0)
      INTO v_total FROM package_payments WHERE package_id = p_package_id;
    UPDATE packages SET paid_amount = v_total, updated_at = now() WHERE id = p_package_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'packages paid_amount update rows=% (expected 1)', v_rows; END IF;
    RETURN jsonb_build_object('ok', true, 'action', 'created_package',
                              'package_payment_id', v_pp_id, 'accounting_date', v_acct_date);
  END IF;

  -- ── 5-b. checkin / single — payments INSERT → raw claim (INSERT-first, FK 충족) ──────
  --   ★순서 = payments INSERT 먼저, 그 다음 raw claim. FK redpay_raw_transactions.matched_payment_id
  --     → payments(id) 는 NOT DEFERRABLE(즉시검증) 이므로 claim-first(payment 미존재) 시 FK 위반.
  --   동시성 안전 = step1 의 SELECT ... FOR UPDATE(raw row lock)가 직렬화점. 경합 caller 는 이 txn
  --     commit 까지 대기 → matched_payment_id NOT NULL 관측(위 line ~113 already_claimed 반환).
  --     즉 lock 이 '선점' 을 이미 보장하므로 INSERT-first 라도 claim-first 와 race 등가(1raw:1payment 멱등).
  IF p_attribution = 'checkin' AND p_check_in_id IS NULL THEN
    RAISE EXCEPTION 'check_in_id required for checkin attribution (orphan 금지)';
  END IF;

  v_pay_id := gen_random_uuid();
  -- created_by 미설정 = recordManualPayment checkin/single 분기 parity(FK user_profiles 리스크 회피).
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

  -- 원자 raw claim (payment 존재 → FK 충족). WHERE matched_payment_id IS NULL 방어 유지.
  --   step1 FOR UPDATE 로 이 raw 는 이미 잠금·미claim 확정 → rows=1 보장. rows<>1 = 이론상 도달불가:
  --   방어적 RAISE 로 전체 txn ABORT(payments INSERT 도 함께 롤백 → orphan payment 방지).
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
  'REDPAY PlanB 카드결제 단일 정본 write-path. FE 경로B + EF 경로A 수렴(single-writer). absorb-guard(K5 CAT-origin)·MERNO tenant-isolation·raw-row 원자 claim 멱등. SSOT=DA-20260802-FOOT-REDPAY-PLANB-SINGLE-RPC-ABSORB-GUARD. T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK.';

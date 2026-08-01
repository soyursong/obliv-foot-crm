/**
 * 런타임 통합 self-QA — record_planb_card_payment RPC (T-20260730-...-SINGLE-RPC-GOLIVE)
 *
 * 무영속(No-Persistence): 전 시나리오를 단일 DO 블록(암묵 txn) 안에서 실행하고 마지막에
 *   RAISE 'INTEGRATION_ALL_PASS' 로 강제 롤백 → prod 무영속(dryrun 표준 §INV-2 동형).
 *   - PASS 판정 = 반환 에러 메시지에 'INTEGRATION_ALL_PASS' 포함(=모든 assert 통과 후 rollback).
 *   - FAIL 판정 = 'ASSERT_FAIL:' 로 시작하는 에러 → 해당 시나리오 실패.
 *
 * 시나리오(티켓 §현장 클릭 3종 + 멱등 + auth):
 *   S1 정상 결제기록(checkin, method='card'·external_trxid·accounting_date=Seoul(approved_at)·check_in 결속)
 *   S2 멱등(동일 raw 재호출 → already_claimed, 신규 INSERT 0)
 *   S3 absorb-guard(CAT payment 존재 → absorbed, payments count 불변)
 *   S4 multi-candidate(≥2) → tier4_manual(claim/insert 안 함)
 *   S5 cross-tenant(MERNO ∉ foot registry) → cross_tenant_reject
 *   S6 auth(authenticated + user_profiles 미소속) → clinic_scope_denied
 *
 * 실행: (repo root) node scripts/T-20260730-foot-REDPAY-PLANB-SINGLE-RPC_integration.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q } from './dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '..', 'supabase', 'migrations', '20260802061500_foot_record_planb_card_payment_rpc.sql');
const upSql = readFileSync(UP, 'utf8');
// CREATE FUNCTION 부분만 추출(첫 REVOKE 이전) — grant/comment 는 로직 테스트 불요.
const createFn = upSql.slice(0, upSql.indexOf('\n-- ── grant seal')).trim();

const test = `
DO $do$
DECLARE
  v_clinic uuid; v_cust uuid; v_ci uuid;
  v_raw uuid; v_raw_dupe uuid; v_raw_abs uuid; v_raw_multi uuid; v_raw_xt uuid;
  v_attempt1 uuid; v_attempt2 uuid; v_attempt3 uuid; v_cat1 uuid; v_cat2 uuid;
  v_res jsonb; v_cnt int; v_acct date; v_pid uuid;
  v_approved timestamptz := '2026-08-02T01:30:00+09:00';  -- KST 2026-08-02 (앵커 검증용)
  v_expected_acct date := '2026-08-02';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 함수 생성(무영속 — 블록 롤백 시 소멸)
  EXECUTE $ddl$${createFn}$ddl$;

  -- ── seed ──────────────────────────────────────────────────────────────
  INSERT INTO clinics (name, slug) VALUES ('TEST_PLANB_RB', 'test-planb-rb-'||gen_random_uuid())
    RETURNING id INTO v_clinic;
  INSERT INTO customers (clinic_id, name, phone, chart_number)
    VALUES (v_clinic, 'TEST환자', '+821012345678', 'TESTCHART-'||substr(gen_random_uuid()::text,1,8))
    RETURNING id INTO v_cust;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, status)
    VALUES (v_clinic, v_cust, 'TEST환자', 'payment_waiting') RETURNING id INTO v_ci;
  -- foot registry MERNO(유효) — 첫 active foot 단말 사용
  INSERT INTO redpay_raw_transactions (clinic_id, external_trxid, external_status, amount, approval_no, tid, approved_at, received_at, raw_payload)
    VALUES (v_clinic, 'TEST_TRX_1', 'Y', 55000, 'APPR001', '1047479261', v_approved, v_approved,
            jsonb_build_object('merchant', (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1)))
    RETURNING id INTO v_raw;

  -- ── S1 정상 결제기록 ────────────────────────────────────────────────────
  v_res := record_planb_card_payment(v_clinic, v_raw, 'checkin', v_cust, v_ci, NULL, 55000, NULL, 'auto', now());
  IF v_res->>'action' <> 'created' THEN RAISE EXCEPTION 'ASSERT_FAIL: S1 action=% res=%', v_res->>'action', v_res; END IF;
  v_pid := (v_res->>'payment_id')::uuid;
  SELECT count(*) INTO v_cnt FROM payments p
    WHERE p.id=v_pid AND p.method='card' AND p.check_in_id=v_ci AND p.customer_id=v_cust
      AND p.external_trxid='TEST_TRX_1' AND p.external_approval_no='APPR001'
      AND p.accounting_date=v_expected_acct AND p.reconciled_at IS NOT NULL
      AND p.created_at=v_approved AND p.amount=55000;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S1 payment row parity mismatch (cnt=%)', v_cnt; END IF;
  -- raw claim
  SELECT count(*) INTO v_cnt FROM redpay_raw_transactions WHERE id=v_raw AND matched_payment_id=v_pid;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S1 raw not claimed'; END IF;
  -- 칸반 해소
  SELECT count(*) INTO v_cnt FROM check_ins WHERE id=v_ci AND status='done';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S1 kanban not resolved'; END IF;
  SELECT count(*) INTO v_cnt FROM status_transitions WHERE check_in_id=v_ci AND to_status='done';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S1 status_transition missing'; END IF;

  -- ── S2 멱등 ─────────────────────────────────────────────────────────────
  v_res := record_planb_card_payment(v_clinic, v_raw, 'checkin', v_cust, v_ci, NULL, 55000, NULL, 'auto', now());
  IF v_res->>'action' <> 'already_claimed' THEN RAISE EXCEPTION 'ASSERT_FAIL: S2 action=%', v_res->>'action'; END IF;
  SELECT count(*) INTO v_cnt FROM payments WHERE external_trxid='TEST_TRX_1';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S2 duplicate payment (cnt=%)', v_cnt; END IF;

  -- ── S3 absorb-guard ─────────────────────────────────────────────────────
  -- CAT 직결 payment(payment_attempt_id NOT NULL, merchant_no ∈ foot registry) + 동일 승인 raw
  INSERT INTO cband_payment_attempts (clinic_id, check_in_id, customer_id, msg_trace, tran_type, requested_amount, status, auth_no)
    VALUES (v_clinic, v_ci, v_cust, 'MSGTRACE_A', '0210', 77000, 'approved', 'APPR777')
    RETURNING id INTO v_attempt1;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type, status,
                        accounting_date, external_approval_no, payment_attempt_id, merchant_no)
    VALUES (v_clinic, v_ci, v_cust, 77000, 'card', 'payment', 'active',
            v_expected_acct, 'APPR777', v_attempt1,
            (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1))
    RETURNING id INTO v_cat1;
  INSERT INTO redpay_raw_transactions (clinic_id, external_trxid, external_status, amount, approval_no, tid, approved_at, received_at, raw_payload)
    VALUES (v_clinic, 'TEST_TRX_ABS', 'Y', 77000, 'APPR777', '1047479261', v_approved, v_approved,
            jsonb_build_object('merchant', (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1)))
    RETURNING id INTO v_raw_abs;
  SELECT count(*) INTO v_cnt FROM payments WHERE clinic_id=v_clinic;  -- 흡수 전 payment 수
  v_res := record_planb_card_payment(v_clinic, v_raw_abs, 'checkin', v_cust, v_ci, NULL, 77000, NULL, 'auto', now());
  IF v_res->>'action' <> 'absorbed' THEN RAISE EXCEPTION 'ASSERT_FAIL: S3 action=% res=%', v_res->>'action', v_res; END IF;
  IF (v_res->>'payment_id')::uuid <> v_cat1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S3 absorbed to wrong payment'; END IF;
  -- count-grain 불변: payments 수 변화 0(신규 INSERT skip)
  DECLARE v_cnt2 int; BEGIN
    SELECT count(*) INTO v_cnt2 FROM payments WHERE clinic_id=v_clinic;
    IF v_cnt2 <> v_cnt THEN RAISE EXCEPTION 'ASSERT_FAIL: S3 payments count changed %→% (double-count)', v_cnt, v_cnt2; END IF;
  END;
  SELECT count(*) INTO v_cnt FROM payments WHERE id=v_cat1 AND reconciled_at IS NOT NULL;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S3 reconciled_at not set on CAT payment'; END IF;
  SELECT count(*) INTO v_cnt FROM redpay_raw_transactions WHERE id=v_raw_abs AND matched_payment_id=v_cat1;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S3 raw not claimed to CAT payment'; END IF;

  -- ── S4 multi-candidate → tier4_manual ───────────────────────────────────
  INSERT INTO cband_payment_attempts (clinic_id, check_in_id, customer_id, msg_trace, tran_type, requested_amount, status, auth_no)
    VALUES (v_clinic, v_ci, v_cust, 'MSGTRACE_B', '0210', 88000, 'approved', 'APPR888')
    RETURNING id INTO v_attempt2;
  -- 별도 attempt(ux_payments_payment_attempt_id 유일제약 준수 — v_attempt1 은 S3 v_cat1 이 이미 소비).
  INSERT INTO cband_payment_attempts (clinic_id, check_in_id, customer_id, msg_trace, tran_type, requested_amount, status, auth_no)
    VALUES (v_clinic, v_ci, v_cust, 'MSGTRACE_C', '0210', 88000, 'approved', 'APPR888')
    RETURNING id INTO v_attempt3;
  -- 동일 composite(amount·acct·approval_no) CAT payment 2건 (각기 다른 payment_attempt_id)
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type, status, accounting_date, external_approval_no, payment_attempt_id, merchant_no)
    VALUES (v_clinic, v_ci, v_cust, 88000, 'card', 'payment', 'active', v_expected_acct, 'APPR888', v_attempt3,
            (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1));
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type, status, accounting_date, external_approval_no, payment_attempt_id, merchant_no)
    VALUES (v_clinic, v_ci, v_cust, 88000, 'card', 'payment', 'active', v_expected_acct, 'APPR888', v_attempt2,
            (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1));
  INSERT INTO redpay_raw_transactions (clinic_id, external_trxid, external_status, amount, approval_no, tid, approved_at, received_at, raw_payload)
    VALUES (v_clinic, 'TEST_TRX_MULTI', 'Y', 88000, 'APPR888', '1047479261', v_approved, v_approved,
            jsonb_build_object('merchant', (SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active LIMIT 1)))
    RETURNING id INTO v_raw_multi;
  v_res := record_planb_card_payment(v_clinic, v_raw_multi, 'checkin', v_cust, v_ci, NULL, 88000, NULL, 'auto', now());
  IF v_res->>'action' <> 'tier4_manual' THEN RAISE EXCEPTION 'ASSERT_FAIL: S4 action=% res=%', v_res->>'action', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM redpay_raw_transactions WHERE id=v_raw_multi AND matched_payment_id IS NULL;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S4 raw claimed despite multi-candidate'; END IF;

  -- ── S5 cross-tenant MERNO reject ────────────────────────────────────────
  INSERT INTO redpay_raw_transactions (clinic_id, external_trxid, external_status, amount, approval_no, tid, approved_at, received_at, raw_payload)
    VALUES (v_clinic, 'TEST_TRX_XT', 'Y', 33000, 'APPRXT', '9999999999', v_approved, v_approved,
            jsonb_build_object('merchant', '0000000000_NOT_FOOT'))
    RETURNING id INTO v_raw_xt;
  v_res := record_planb_card_payment(v_clinic, v_raw_xt, 'checkin', v_cust, v_ci, NULL, 33000, NULL, 'auto', now());
  IF v_res->>'action' <> 'cross_tenant_reject' THEN RAISE EXCEPTION 'ASSERT_FAIL: S5 action=% res=%', v_res->>'action', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM redpay_raw_transactions WHERE id=v_raw_xt AND matched_payment_id IS NULL;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT_FAIL: S5 cross-tenant raw claimed'; END IF;

  -- ── S6 auth(authenticated + user_profiles 미소속) → clinic_scope_denied ────────────
  DECLARE v_caught boolean := false; BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}', true);
    BEGIN
      v_res := record_planb_card_payment(v_clinic, v_raw, 'checkin', v_cust, v_ci, NULL, 55000, NULL, 'manual', now());
    EXCEPTION WHEN insufficient_privilege THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'ASSERT_FAIL: S6 non-staff authenticated not denied'; END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  END;

  RAISE EXCEPTION 'INTEGRATION_ALL_PASS';
END $do$;
`;

try {
  await q(test);
  console.error('UNEXPECTED: no rollback error returned (test must end with RAISE). FAIL.');
  process.exit(1);
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes('INTEGRATION_ALL_PASS')) {
    console.log('== INTEGRATION PASS == S1 created · S2 idempotent · S3 absorbed · S4 tier4_manual · S5 cross_tenant_reject · S6 auth-deny · (rolled back, 무영속)');
    process.exit(0);
  }
  if (msg.includes('ASSERT_FAIL')) {
    const m = msg.match(/ASSERT_FAIL:[^"\\]*/);
    console.error('== INTEGRATION FAIL ==\n', m ? m[0] : msg);
    process.exit(1);
  }
  console.error('== INTEGRATION ERROR (not an assert) ==\n', msg);
  process.exit(2);
}

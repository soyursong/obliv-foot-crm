-- DRY-RUN (No-Persistence): T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 txn-control 문(COMMIT 등) 없음 = sentinel-bypass hazard 부재 → BEGIN..ROLLBACK 자체 무영속.
--   · txn 내부 assertion(DO $chk$): 함수 생성/시그니처 실검증, 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 pg_proc 부재 재확인.
BEGIN;

CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID,
  p_method     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig       package_payments%ROWTYPE;
  v_pkg        packages%ROWTYPE;
  v_prior      INTEGER;
  v_refund     INTEGER;
  v_new_id     UUID;
  v_net_paid   INTEGER;
  v_caller_clinic UUID;
BEGIN
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('error', '환불 권한이 없습니다.');
  END IF;

  SELECT * INTO v_orig
  FROM package_payments
  WHERE id = p_payment_id
    AND payment_type = 'payment'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_orig.clinic_id IS NULL OR v_orig.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('error', '해당 결제에 대한 환불 권한이 없습니다.');
  END IF;

  SELECT * INTO v_pkg FROM packages WHERE id = v_orig.package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다.');
  END IF;

  v_refund := v_orig.amount;
  IF v_refund <= 0 THEN
    RETURN jsonb_build_object('error', '환불할 결제 금액이 없습니다.');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_prior
  FROM package_payments
  WHERE parent_payment_id = p_payment_id
    AND payment_type = 'refund';

  IF v_prior + v_refund > v_orig.amount THEN
    RETURN jsonb_build_object(
      'error',
      format('환불 가능 잔여금액(%s원)을 초과합니다. (원결제 %s원 / 기환불 %s원)',
             GREATEST(v_orig.amount - v_prior, 0), v_orig.amount, v_prior)
    );
  END IF;

  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind
  )
  RETURNING id INTO v_new_id;

  SELECT COALESCE(
           SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE -amount END), 0)
    INTO v_net_paid
  FROM package_payments
  WHERE package_id = v_orig.package_id;

  IF v_net_paid <= 0 AND v_pkg.status = 'active' THEN
    UPDATE packages SET status = 'refunded' WHERE id = v_orig.package_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_new_id,
    'refund_amount', v_refund,
    'package_refunded', (v_net_paid <= 0 AND v_pkg.status = 'active')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION refund_package_payment(UUID, TEXT) TO authenticated;

-- ── txn 내부 검증: 함수·시그니처·SECURITY DEFINER 실존 확인 (실패 시 abort) ──
DO $chk$
DECLARE
  v_args TEXT;
  v_secdef BOOLEAN;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid), p.prosecdef
    INTO v_args, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'refund_package_payment';

  IF v_args IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: refund_package_payment 미생성';
  END IF;
  IF v_args <> 'p_payment_id uuid, p_method text' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 시그니처 불일치 (got: %)', v_args;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: SECURITY DEFINER 아님';
  END IF;
  RAISE NOTICE 'DRYRUN-OK: refund_package_payment(%) SECURITY DEFINER 생성 확인', v_args;
END $chk$;

ROLLBACK;

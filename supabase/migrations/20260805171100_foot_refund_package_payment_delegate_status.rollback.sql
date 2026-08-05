-- ROLLBACK: T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §3
-- 20260805171100_foot_refund_package_payment_delegate_status.sql 역연산.
--   refund_package_payment 를 직전 버전(20260727210000, 단방향 status 가드 + created_by 포함)으로 복원.
--   ⚠ 배포순서: §3 RPC 복원(단방향 가드 부활)은 §2 트리거 롤백과 함께 수행해야
--      status 파생 authority 공백(이중 미파생) 또는 중복(이중 파생)을 방지한다.

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
    clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind, created_by
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind, auth.uid()
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

COMMENT ON FUNCTION refund_package_payment(UUID, TEXT)
  IS '패키지 결제행 단위 환불(선택 row amount 서버 재조회·과다환불 상한·session cascade OFF·처리자 created_by auto-capture). T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH + T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY / DA-ADDITIVE-GO';

GRANT EXECUTE ON FUNCTION refund_package_payment(UUID, TEXT) TO authenticated;

COMMIT;

-- ROLLBACK — T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX
-- 3 RPC 를 직전 정의(p_method 를 method 슬롯에 기록)로 복원 + ADDITIVE 컬럼 2개 DROP.
-- ⚠ 롤백 시 method 귀속 desync 버그가 재현된다(의도적 원상복구). disbursement 컬럼의
--   기존 forward 데이터는 유실(컬럼 DROP). 롤백 전 supervisor 확인 필수.

BEGIN;

-- STEP 4 복원: refund_package_atomic (직전 = 단일 lump row, method=p_method)
CREATE OR REPLACE FUNCTION refund_package_atomic(
  p_package_id UUID,
  p_clinic_id UUID,
  p_customer_id UUID,
  p_method TEXT
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_quote JSONB;
  v_refund_amount INTEGER;
BEGIN
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status = 'refunded' THEN
    RETURN jsonb_build_object('error', '이미 환불된 패키지입니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '활성 상태의 패키지만 환불 가능합니다');
  END IF;
  v_quote := calc_refund_amount(p_package_id);
  v_refund_amount := COALESCE((v_quote->>'refund_amount')::INTEGER, 0);
  INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, payment_type)
  VALUES (p_clinic_id, p_package_id, p_customer_id, v_refund_amount, p_method, 'refund');
  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;
  UPDATE package_sessions SET status = 'refunded'
   WHERE package_id = p_package_id AND status = 'used';
  RETURN jsonb_build_object('ok', true, 'refund_amount', v_refund_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMENT ON FUNCTION refund_package_atomic(UUID, UUID, UUID, TEXT)
  IS '패키지 원자 환불 + package_sessions cascade(used→refunded). T-20260602-foot-REFUND-SESSION-CLEANUP';

-- STEP 3 복원: refund_package_payment (직전 = method=p_method, disbursement 없음)
CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID, p_method TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig package_payments%ROWTYPE; v_pkg packages%ROWTYPE;
  v_prior INTEGER; v_refund INTEGER; v_new_id UUID; v_net_paid INTEGER; v_caller_clinic UUID;
BEGIN
  IF NOT is_approved_user() THEN RETURN jsonb_build_object('error', '환불 권한이 없습니다.'); END IF;
  SELECT * INTO v_orig FROM package_payments WHERE id = p_payment_id AND payment_type = 'payment' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '원결제 내역을 찾을 수 없습니다.'); END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_orig.clinic_id IS NULL OR v_orig.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('error', '해당 결제에 대한 환불 권한이 없습니다.'); END IF;
  SELECT * INTO v_pkg FROM packages WHERE id = v_orig.package_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다.'); END IF;
  v_refund := v_orig.amount;
  IF v_refund <= 0 THEN RETURN jsonb_build_object('error', '환불할 결제 금액이 없습니다.'); END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_prior FROM package_payments
    WHERE parent_payment_id = p_payment_id AND payment_type = 'refund';
  IF v_prior + v_refund > v_orig.amount THEN
    RETURN jsonb_build_object('error',
      format('환불 가능 잔여금액(%s원)을 초과합니다. (원결제 %s원 / 기환불 %s원)',
             GREATEST(v_orig.amount - v_prior, 0), v_orig.amount, v_prior)); END IF;
  INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind)
  VALUES (v_orig.clinic_id, v_orig.package_id, v_orig.customer_id, v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind)
  RETURNING id INTO v_new_id;
  SELECT COALESCE(SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE -amount END), 0) INTO v_net_paid
    FROM package_payments WHERE package_id = v_orig.package_id;
  IF v_net_paid <= 0 AND v_pkg.status = 'active' THEN
    UPDATE packages SET status = 'refunded' WHERE id = v_orig.package_id; END IF;
  RETURN jsonb_build_object('ok', true, 'refund_id', v_new_id, 'refund_amount', v_refund,
    'package_refunded', (v_net_paid <= 0 AND v_pkg.status = 'active'));
END;
$$;

-- STEP 2 복원: refund_single_payment (직전 = method=p_method, linked_payment_id only, parent 미persist)
CREATE OR REPLACE FUNCTION refund_single_payment(
  p_payment_id UUID, p_clinic_id UUID, p_amount INTEGER, p_method TEXT, p_memo TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_original payments%ROWTYPE; v_role TEXT; v_new_id UUID;
BEGIN
  SELECT up.role INTO v_role FROM user_profiles up WHERE up.id = auth.uid() AND up.active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다. (admin/manager 전용)'); END IF;
  SELECT * INTO v_original FROM payments
    WHERE id = p_payment_id AND clinic_id = p_clinic_id AND payment_type = 'payment'
      AND COALESCE(status, 'active') != 'deleted';
  IF NOT FOUND THEN RETURN json_build_object('error', '원결제 내역을 찾을 수 없습니다.'); END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('error', '환불금액은 0보다 커야 합니다.'); END IF;
  IF p_amount > v_original.amount THEN
    RETURN json_build_object('error', format('환불금액이 원결제 금액(%s원)을 초과할 수 없습니다.', v_original.amount)); END IF;
  IF p_memo IS NULL OR trim(p_memo) = '' THEN RETURN json_build_object('error', '환불 사유를 입력해 주세요.'); END IF;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type, installment, memo, linked_payment_id, status)
  VALUES (p_clinic_id, v_original.check_in_id, v_original.customer_id, p_amount, p_method, 'refund', 0, p_memo, p_payment_id, 'active')
  RETURNING id INTO v_new_id;
  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END;
$$;

-- STEP 1 복원: ADDITIVE 컬럼 DROP
ALTER TABLE public.package_payments DROP COLUMN IF EXISTS refund_disbursement_method;
ALTER TABLE public.payments DROP COLUMN IF EXISTS refund_disbursement_method;

COMMIT;

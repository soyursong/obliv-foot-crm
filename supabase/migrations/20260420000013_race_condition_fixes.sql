-- foot-030: Atomic race condition fixes

-- 1. Atomic session deduction with FOR UPDATE lock
CREATE OR REPLACE FUNCTION deduct_session_atomic(
  p_check_in_id UUID,
  p_package_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_used INT;
  v_remaining INT;
  v_session_type TEXT;
  v_next_num INT;
BEGIN
  -- Lock the package row
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '패키지가 활성 상태가 아닙니다');
  END IF;

  -- Check duplicate
  IF EXISTS (SELECT 1 FROM package_sessions WHERE package_id = p_package_id AND check_in_id = p_check_in_id) THEN
    RETURN jsonb_build_object('ok', true, 'msg', 'already_deducted');
  END IF;

  -- Count used sessions
  SELECT COUNT(*) INTO v_used FROM package_sessions WHERE package_id = p_package_id AND status = 'used';
  v_remaining := v_pkg.total_sessions - v_used;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('error', '남은 회차가 없습니다');
  END IF;

  -- Determine session type from remaining individual counts
  v_session_type := CASE
    WHEN v_pkg.heated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'heated_laser' AND status = 'used'), 0) > 0 THEN 'heated_laser'
    WHEN v_pkg.unheated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'unheated_laser' AND status = 'used'), 0) > 0 THEN 'unheated_laser'
    WHEN v_pkg.iv_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'iv' AND status = 'used'), 0) > 0 THEN 'iv'
    WHEN v_pkg.preconditioning_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'preconditioning' AND status = 'used'), 0) > 0 THEN 'preconditioning'
    ELSE 'heated_laser'
  END;

  v_next_num := v_used + 1;

  INSERT INTO package_sessions (package_id, check_in_id, session_number, session_type, session_date, status)
  VALUES (p_package_id, p_check_in_id, v_next_num, v_session_type, CURRENT_DATE, 'used');

  RETURN jsonb_build_object('ok', true, 'session_number', v_next_num, 'session_type', v_session_type, 'remaining', v_remaining - 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Batch check-in in a single transaction
CREATE OR REPLACE FUNCTION batch_checkin(
  p_clinic_id UUID,
  p_reservations JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res JSONB;
  v_qn INT;
  v_success INT := 0;
  v_skipped INT := 0;
  v_date TEXT;
BEGIN
  FOR v_res IN SELECT * FROM jsonb_array_elements(p_reservations)
  LOOP
    v_date := v_res->>'reservation_date';

    -- Skip if already checked in
    IF EXISTS (SELECT 1 FROM check_ins WHERE reservation_id = (v_res->>'id')::UUID) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Atomic queue number
    PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::TEXT || v_date));
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_qn
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND checked_in_at::DATE = v_date::DATE;

    INSERT INTO check_ins (
      clinic_id, customer_id, reservation_id, customer_name, customer_phone,
      visit_type, status, queue_number
    ) VALUES (
      p_clinic_id,
      (v_res->>'customer_id')::UUID,
      (v_res->>'id')::UUID,
      v_res->>'customer_name',
      v_res->>'customer_phone',
      v_res->>'visit_type',
      'registered',
      v_qn
    );

    UPDATE reservations SET status = 'checked_in' WHERE id = (v_res->>'id')::UUID;
    v_success := v_success + 1;
  END LOOP;

  RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Atomic refund with FOR UPDATE lock
CREATE OR REPLACE FUNCTION refund_package_atomic(
  p_package_id UUID,
  p_clinic_id UUID,
  p_customer_id UUID,
  p_method TEXT
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_quote RECORD;
BEGIN
  -- Lock the package row
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

  -- Calculate refund
  SELECT * INTO v_quote FROM calc_refund_amount(p_package_id);

  INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, payment_type)
  VALUES (p_clinic_id, p_package_id, p_customer_id, v_quote.refund_amount, p_method, 'refund');

  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;

  RETURN jsonb_build_object('ok', true, 'refund_amount', v_quote.refund_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ROLLBACK: T-20260602-foot-REFUND-SESSION-CLEANUP (refund_package_atomic 세션 cascade 제거)
--   package_sessions cascade UPDATE 1줄을 제거하여 20260420000013_race_condition_fixes.sql 의
--   원본 정의로 환원한다.
--   ⚠ 환원 시 환불 패키지의 'used' 세션이 다시 잔류 → 통계(foot_stats_by_category) 유령 카운트 재현(의도적).
--   ⚠ 이미 backfill 로 'refunded' 전이된 과거 세션은 본 롤백으로 복구되지 않음(별도 backfill 롤백 참조).
--   적용: node scripts/apply_20260603000000_refund_session_cascade.mjs --rollback
--   author: dev-foot / 2026-06-03

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

  SELECT * INTO v_quote FROM calc_refund_amount(p_package_id);

  INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, payment_type)
  VALUES (p_clinic_id, p_package_id, p_customer_id, v_quote.refund_amount, p_method, 'refund');

  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;

  RETURN jsonb_build_object('ok', true, 'refund_amount', v_quote.refund_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

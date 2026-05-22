-- T-20260522-foot-CLOSING-REFUND
-- 단건 결제 환불 지원: linked_payment_id 컬럼 + refund_single_payment RPC
-- 관련 티켓: T-20260522-foot-CLOSING-REFUND

-- ──────────────────────────────────────────────────────────────
-- 1. payments 테이블에 linked_payment_id 컬럼 추가
--    환불 행이 원결제 행을 참조하기 위한 FK
-- ──────────────────────────────────────────────────────────────
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS linked_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_linked ON payments(linked_payment_id)
  WHERE linked_payment_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. refund_single_payment RPC
--    payments 테이블에 payment_type='refund' 행 삽입
--    - 권한: admin/manager만 호출 가능 (내부 검증)
--    - 금액 검증: 0 < p_amount ≤ 원결제 금액
--    - 사유 검증: p_memo 필수
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_single_payment(
  p_payment_id  UUID,
  p_clinic_id   UUID,
  p_amount      INTEGER,
  p_method      TEXT,
  p_memo        TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original  payments%ROWTYPE;
  v_role      TEXT;
  v_new_id    UUID;
BEGIN
  -- 1. 권한 확인 (admin/manager만 환불 가능)
  SELECT up.role INTO v_role
  FROM user_profiles up
  WHERE up.id = auth.uid()
    AND up.active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다. (admin/manager 전용)');
  END IF;

  -- 2. 원결제 조회
  SELECT * INTO v_original
  FROM payments
  WHERE id          = p_payment_id
    AND clinic_id   = p_clinic_id
    AND payment_type = 'payment'
    AND COALESCE(status, 'active') != 'deleted';

  IF NOT FOUND THEN
    RETURN json_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  -- 3. 환불 금액 검증
  IF p_amount <= 0 THEN
    RETURN json_build_object('error', '환불금액은 0보다 커야 합니다.');
  END IF;
  IF p_amount > v_original.amount THEN
    RETURN json_build_object(
      'error',
      format('환불금액이 원결제 금액(%s원)을 초과할 수 없습니다.', v_original.amount)
    );
  END IF;

  -- 4. 사유 검증
  IF p_memo IS NULL OR trim(p_memo) = '' THEN
    RETURN json_build_object('error', '환불 사유를 입력해 주세요.');
  END IF;

  -- 5. 환불 행 삽입
  INSERT INTO payments (
    clinic_id,
    check_in_id,
    customer_id,
    amount,
    method,
    payment_type,
    installment,
    memo,
    linked_payment_id,
    status
  )
  VALUES (
    p_clinic_id,
    v_original.check_in_id,
    v_original.customer_id,
    p_amount,
    p_method,
    'refund',
    0,
    p_memo,
    p_payment_id,
    'active'
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END;
$$;

-- 인증된 사용자 실행 권한 부여
GRANT EXECUTE ON FUNCTION refund_single_payment(UUID, UUID, INTEGER, TEXT, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- AC-4 조사 결론: closing_manual_payments payment_type 불필요
--   수기 결제는 직접 입력 항목이므로 환불 시 수기 삭제+재입력 패턴 유지.
--   DB 컬럼 추가 없음.
-- ──────────────────────────────────────────────────────────────

-- 롤백 SQL:
-- DROP FUNCTION IF EXISTS refund_single_payment(UUID, UUID, INTEGER, TEXT, TEXT);
-- DROP INDEX IF EXISTS idx_payments_linked;
-- ALTER TABLE payments DROP COLUMN IF EXISTS linked_payment_id;

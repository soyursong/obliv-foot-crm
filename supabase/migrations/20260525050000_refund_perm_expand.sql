-- T-20260525-foot-ROLE-PERM-CUSTOM AC-4~AC-7
-- 환불 처리 권한 확장: admin/manager → + consultant/coordinator/therapist
-- 조사 결과: role_permissions 전용 테이블 없음. 환불 권한은 RPC 내부 v_role 검증으로 단일 관리.
-- 변경 범위: refund_single_payment RPC 역할 목록 확장 (refund_package_atomic은 역할 검증 없음 → 그대로)

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
  -- 1. 권한 확인
  --    T-20260525-foot-ROLE-PERM-CUSTOM: admin/manager + consultant/coordinator/therapist 허용
  SELECT up.role INTO v_role
  FROM user_profiles up
  WHERE up.id = auth.uid()
    AND up.active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager', 'consultant', 'coordinator', 'therapist') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다.');
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

-- 실행 권한 (기존 유지 — authenticated 사용자에게 부여됨)
GRANT EXECUTE ON FUNCTION refund_single_payment(UUID, UUID, INTEGER, TEXT, TEXT) TO authenticated;

-- T-20260504-foot-PACKAGE-CRUD: 안전한 패키지 삭제 RPC
-- 사용 이력(package_sessions) 또는 결제 이력(package_payments)이 있으면 삭제 불가
-- 양도(transferred)된 패키지(원본/사본)는 삭제 불가
-- admin / manager 만 호출 가능

CREATE OR REPLACE FUNCTION delete_package_safe(p_package_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg packages%ROWTYPE;
  v_session_count INT;
  v_payment_count INT;
  v_transfer_links INT;
BEGIN
  -- 권한 체크: admin/manager 만 허용
  IF NOT is_admin_or_manager() THEN
    RETURN jsonb_build_object('ok', false, 'error', '권한 없음 (관리자/매니저만 삭제 가능)');
  END IF;

  -- 대상 조회
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '패키지를 찾을 수 없음');
  END IF;

  -- 양도된 패키지(원본/사본) 삭제 차단
  IF v_pkg.status = 'transferred' OR v_pkg.transferred_from IS NOT NULL OR v_pkg.transferred_to IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '양도된 패키지는 삭제할 수 없음 (이력 보존)');
  END IF;

  -- 소진 이력 검사
  SELECT COUNT(*) INTO v_session_count FROM package_sessions WHERE package_id = p_package_id;
  IF v_session_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('소진 이력 %s건이 있어 삭제할 수 없음 (환불 처리 권장)', v_session_count)
    );
  END IF;

  -- 결제 이력 검사
  SELECT COUNT(*) INTO v_payment_count FROM package_payments WHERE package_id = p_package_id;
  IF v_payment_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('결제 이력 %s건이 있어 삭제할 수 없음 (환불 처리 권장)', v_payment_count)
    );
  END IF;

  -- check_ins 에서 참조 중이면 차단 (FK 보존)
  SELECT COUNT(*) INTO v_transfer_links FROM check_ins WHERE package_id = p_package_id;
  IF v_transfer_links > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('체크인 %s건에서 사용 중이라 삭제할 수 없음', v_transfer_links)
    );
  END IF;

  -- 안전: 실제 삭제
  DELETE FROM packages WHERE id = p_package_id;

  RETURN jsonb_build_object('ok', true, 'deleted_id', p_package_id);
END;
$$;

-- 풋센터 표준: anon revoke + authenticated grant (SECURITY DEFINER 패턴)
REVOKE EXECUTE ON FUNCTION delete_package_safe(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION delete_package_safe(UUID) TO authenticated;

COMMENT ON FUNCTION delete_package_safe(UUID) IS
  'T-20260504-foot-PACKAGE-CRUD: admin/manager 권한 체크 + 사용/결제/양도/체크인 이력 검사 후 안전 삭제';

-- ROLLBACK: T-20260526-foot-DUMMY-12RX
-- [경과테스트] 더미 환자 데이터 제거 (이수진·김태호 010-9901-0001/0002)
-- 전화번호 기준 정밀 삭제 — is_simulation=true 전체 삭제와 충돌 없음

DO $$
DECLARE
  v_clinic uuid;
BEGIN
  SELECT id INTO v_clinic FROM clinics WHERE slug = 'jongno-foot';

  -- medical_charts (FK 없음, 명시 삭제)
  DELETE FROM medical_charts
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE phone IN ('010-9901-0001', '010-9901-0002')
      AND clinic_id = v_clinic
  );

  -- check_ins → CASCADE: check_in_services, status_transitions
  DELETE FROM check_ins
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE phone IN ('010-9901-0001', '010-9901-0002')
      AND clinic_id = v_clinic
  );

  -- payments
  DELETE FROM payments
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE phone IN ('010-9901-0001', '010-9901-0002')
      AND clinic_id = v_clinic
  );

  -- packages → CASCADE: package_sessions
  DELETE FROM packages
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE phone IN ('010-9901-0001', '010-9901-0002')
      AND clinic_id = v_clinic
  );

  -- customers → CASCADE: customer_treatment_memos
  DELETE FROM customers
  WHERE phone IN ('010-9901-0001', '010-9901-0002')
    AND clinic_id = v_clinic;

  RAISE NOTICE '✅ [경과테스트] 롤백 완료 — 이수진(010-9901-0001), 김태호(010-9901-0002) 삭제';
END $$;

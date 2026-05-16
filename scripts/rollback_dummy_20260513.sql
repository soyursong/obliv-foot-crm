-- =============================================================
-- 롤백 SQL — 더미데이터 30건 삭제 (T-20260513-foot-DUMMY-DATA-30)
-- 식별 기준: customers.name LIKE '[TEST]%' AND is_simulation = true
-- 실행: node 스크립트 또는 psql로 실행
-- =============================================================

BEGIN;

-- 1) 결제 기록 삭제
DELETE FROM payments
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 2) 패키지 결제 기록 삭제
DELETE FROM package_payments
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 3) 체크인 서비스 삭제
DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.name LIKE '[TEST]%' AND c.is_simulation = true
);

-- 4) 패키지 세션 삭제
DELETE FROM package_sessions
WHERE package_id IN (
  SELECT p.id FROM packages p
  JOIN customers c ON p.customer_id = c.id
  WHERE c.name LIKE '[TEST]%' AND c.is_simulation = true
);

-- 5) 상태 전이 로그 삭제
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.name LIKE '[TEST]%' AND c.is_simulation = true
);

-- 6) 동의서 삭제
DELETE FROM consent_forms
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 7) 체크리스트 삭제
DELETE FROM checklists
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 8) 체크인 삭제 (오늘 + 과거 방문 이력 모두)
DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 9) 패키지 삭제
DELETE FROM packages
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 10) 예약 삭제
DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true
);

-- 11) 고객 삭제 (마지막 — FK 의존)
DELETE FROM customers
WHERE name LIKE '[TEST]%' AND is_simulation = true;

-- 검증
DO $$
DECLARE v_cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM customers WHERE name LIKE '[TEST]%' AND is_simulation = true;
  IF v_cnt = 0 THEN
    RAISE NOTICE '✅ 롤백 완료 — [TEST] 고객 0건 잔여';
  ELSE
    RAISE WARNING '⚠️ [TEST] 고객 %건 아직 잔여. 확인 필요', v_cnt;
  END IF;
END $$;

COMMIT;

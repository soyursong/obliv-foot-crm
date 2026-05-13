-- =============================================================
-- 롤백 SQL — 셀프접수 테스트 더미 예약 20건 삭제
-- T-20260514-foot-SELFCHECKIN-TESTDATA3
-- 식별 기준: customers.name LIKE '[TEST3]%' AND is_simulation = true
-- 전화번호 대역: +82109903xxxx (+821099030001 ~ +821099030020)
-- =============================================================

BEGIN;

-- 1) 체크인 서비스 삭제 (있으면)
DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.name LIKE '[TEST3]%' AND c.is_simulation = true
);

-- 2) 패키지 세션 삭제 (있으면)
DELETE FROM package_sessions
WHERE package_id IN (
  SELECT p.id FROM packages p
  JOIN customers c ON p.customer_id = c.id
  WHERE c.name LIKE '[TEST3]%' AND c.is_simulation = true
);

-- 3) 상태 전이 로그 삭제 (있으면)
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.name LIKE '[TEST3]%' AND c.is_simulation = true
);

-- 4) 결제 기록 삭제 (있으면)
DELETE FROM payments
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true
);

-- 5) 패키지 결제 기록 삭제 (있으면)
DELETE FROM package_payments
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true
);

-- 6) 체크인 삭제 (과거 방문 이력 포함)
DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true
);

-- 7) 패키지 삭제 (있으면)
DELETE FROM packages
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true
);

-- 8) 예약 삭제
DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true
);

-- 9) 고객 삭제 (마지막 — FK 의존)
DELETE FROM customers
WHERE name LIKE '[TEST3]%' AND is_simulation = true;

-- 검증
DO $$
DECLARE v_cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM customers WHERE name LIKE '[TEST3]%' AND is_simulation = true;
  IF v_cnt = 0 THEN
    RAISE NOTICE '✅ 롤백 완료 — [TEST3] 고객 0건 잔여';
  ELSE
    RAISE WARNING '⚠️ [TEST3] 고객 %건 아직 잔여. 확인 필요', v_cnt;
  END IF;
END $$;

COMMIT;

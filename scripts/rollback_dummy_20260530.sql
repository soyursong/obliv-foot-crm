-- ============================================================
-- 롤백 SQL: T-20260530-foot-DUMMY-DATA-0530 (V5)
-- 5/30 더미 예약 데이터 전체 삭제 (고객 128명 + 예약 128건 + 과거체크인 64건)
--
-- 삭제 대상:
--   customers:    128건 (초진 동물이름 64 + 재진 과일이름 64), is_simulation=true
--   reservations: 128건 (2026-05-30, 10:00~17:30, 30분 간격)
--   check_ins:     64건 (재진 판별용 과거 체크인, 2026-05-01)
--
-- 식별 기준:
--   phone BETWEEN '+821099060001' AND '+821099060128' AND is_simulation = true
--   (비중복 테스트 번호 범위 — 실환자 보호)
--
-- INSERT 스크립트: scripts/seed_testdata_20260530.mjs
-- JS 롤백 스크립트: scripts/rollback_testdata_20260530.mjs
--
-- 실행: psql $DATABASE_URL < scripts/rollback_dummy_20260530.sql
-- ============================================================

BEGIN;

-- STEP 1: payments 삭제
DELETE FROM payments
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821099060001' AND '+821099060128'
    AND is_simulation = true
);

-- STEP 2: check_in_services 삭제
DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.phone BETWEEN '+821099060001' AND '+821099060128'
    AND c.is_simulation = true
);

-- STEP 3: status_transitions 삭제
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.phone BETWEEN '+821099060001' AND '+821099060128'
    AND c.is_simulation = true
);

-- STEP 4: check_ins 삭제 (재진 과거체크인 64건 포함)
DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821099060001' AND '+821099060128'
    AND is_simulation = true
);

-- STEP 5: reservations 삭제 (128건, 2026-05-30)
DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821099060001' AND '+821099060128'
    AND is_simulation = true
)
AND reservation_date = '2026-05-30';

-- STEP 6: package_sessions 삭제 (존재하는 경우)
DELETE FROM package_sessions
WHERE package_id IN (
  SELECT p.id FROM packages p
  JOIN customers c ON p.customer_id = c.id
  WHERE c.phone BETWEEN '+821099060001' AND '+821099060128'
    AND c.is_simulation = true
);

-- STEP 7: packages 삭제
DELETE FROM packages
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821099060001' AND '+821099060128'
    AND is_simulation = true
);

-- STEP 8: consent_forms 삭제
DELETE FROM consent_forms
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821099060001' AND '+821099060128'
    AND is_simulation = true
);

-- STEP 9: customers 삭제 (마지막 — FK 의존)
DELETE FROM customers
WHERE phone BETWEEN '+821099060001' AND '+821099060128'
  AND is_simulation = true;

-- ── 검증 ────────────────────────────────────────────────────
DO $$
DECLARE
  v_cust  INTEGER;
  v_resv  INTEGER;
  v_ci    INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cust
    FROM customers
   WHERE phone BETWEEN '+821099060001' AND '+821099060128'
     AND is_simulation = true;

  SELECT COUNT(*) INTO v_resv
    FROM reservations
   WHERE reservation_date = '2026-05-30'
     AND memo LIKE '%testdata_20260530%';

  SELECT COUNT(*) INTO v_ci
    FROM check_ins
   WHERE notes::text LIKE '%testdata_20260530%';

  IF v_cust = 0 AND v_resv = 0 AND v_ci = 0 THEN
    RAISE NOTICE '✅ 롤백 완료 — 고객 0건 / 예약 0건 / 체크인 0건 잔여';
  ELSE
    RAISE WARNING '⚠️  잔여 데이터 존재: 고객 %건 / 예약 %건 / 체크인 %건', v_cust, v_resv, v_ci;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- 참고 — 삭제 확인 쿼리 (실행 후 모두 0 이어야 함)
-- SELECT count(*) FROM customers
--   WHERE phone BETWEEN '+821099060001' AND '+821099060128' AND is_simulation = true;
-- SELECT count(*) FROM reservations
--   WHERE reservation_date = '2026-05-30' AND memo LIKE '%testdata_20260530%';
-- SELECT count(*) FROM check_ins
--   WHERE notes::text LIKE '%testdata_20260530%';
-- ============================================================

-- ============================================================
-- 롤백 SQL: T-20260529-foot-DUMMY-DATA-0529
-- 5/29 더미 예약 데이터 전체 삭제 (고객 80명 + 예약 80건 + 과거체크인 40건)
--
-- 삭제 대상:
--   customers:    80건 (초진 동물이름 40 + 재진 과일이름 40), is_simulation=true
--   reservations: 80건 (2026-05-29, 10:00~19:00)
--   check_ins:    40건 (재진 판별용 과거 체크인, 2026-05-01)
--
-- 식별 기준:
--   phone IN (+821000002901 ~ +821000002980) AND is_simulation = true
--   (비중복 테스트 번호 범위 — 실환자 보호)
--
-- INSERT 스크립트 위치: scripts/seed_testdata_20260529.mjs
-- 롤백  스크립트 위치: scripts/rollback_dummy_20260529.sql  ← 이 파일
--                     scripts/rollback_testdata_20260529.mjs (JS 버전)
--
-- 실행: psql $DATABASE_URL < scripts/rollback_dummy_20260529.sql
-- ============================================================

BEGIN;

-- ── 대상 고객 ID 임시 식별 ─────────────────────────────────────
-- 아래 CTE를 기준으로 하위 모든 테이블 삭제
-- 전화번호 범위: +821000002901 ~ +821000002980 (80개)

-- STEP 1: payments 삭제
DELETE FROM payments
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821000002901' AND '+821000002980'
    AND is_simulation = true
);

-- STEP 2: check_in_services 삭제
DELETE FROM check_in_services
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.phone BETWEEN '+821000002901' AND '+821000002980'
    AND c.is_simulation = true
);

-- STEP 3: status_transitions 삭제
DELETE FROM status_transitions
WHERE check_in_id IN (
  SELECT ci.id FROM check_ins ci
  JOIN customers c ON ci.customer_id = c.id
  WHERE c.phone BETWEEN '+821000002901' AND '+821000002980'
    AND c.is_simulation = true
);

-- STEP 4: check_ins 삭제 (재진 과거체크인 40건 포함)
DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821000002901' AND '+821000002980'
    AND is_simulation = true
);

-- STEP 5: reservations 삭제 (80건, 2026-05-29)
DELETE FROM reservations
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821000002901' AND '+821000002980'
    AND is_simulation = true
)
AND reservation_date = '2026-05-29';

-- STEP 6: package_sessions 삭제 (존재하는 경우)
DELETE FROM package_sessions
WHERE package_id IN (
  SELECT p.id FROM packages p
  JOIN customers c ON p.customer_id = c.id
  WHERE c.phone BETWEEN '+821000002901' AND '+821000002980'
    AND c.is_simulation = true
);

-- STEP 7: packages 삭제
DELETE FROM packages
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821000002901' AND '+821000002980'
    AND is_simulation = true
);

-- STEP 8: consent_forms 삭제
DELETE FROM consent_forms
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE phone BETWEEN '+821000002901' AND '+821000002980'
    AND is_simulation = true
);

-- STEP 9: customers 삭제 (마지막 — FK 의존)
DELETE FROM customers
WHERE phone BETWEEN '+821000002901' AND '+821000002980'
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
   WHERE phone BETWEEN '+821000002901' AND '+821000002980'
     AND is_simulation = true;

  SELECT COUNT(*) INTO v_resv
    FROM reservations
   WHERE reservation_date = '2026-05-29'
     AND memo LIKE '%testdata_20260529%';

  SELECT COUNT(*) INTO v_ci
    FROM check_ins
   WHERE checked_in_at >= '2026-05-01'
     AND notes::text LIKE '%testdata_20260529%';

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
--   WHERE phone BETWEEN '+821000002901' AND '+821000002980' AND is_simulation = true;
-- SELECT count(*) FROM reservations
--   WHERE reservation_date = '2026-05-29' AND memo LIKE '%testdata_20260529%';
-- SELECT count(*) FROM check_ins
--   WHERE notes::text LIKE '%testdata_20260529%';
-- ============================================================

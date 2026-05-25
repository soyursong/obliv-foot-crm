-- ============================================================
-- 롤백 SQL: T-20260525-foot-DUMMY-DATA-GEN
-- 5/26 더미 예약 데이터 72건 삭제
-- 대상 태그: created_by = 'dummy-seed-20260526'
-- ============================================================
-- 삭제 순서 (FK 의존성):
--   check_ins → reservations → customers
-- 식별 기준:
--   - created_by = 'dummy-seed-20260526'
--   - is_simulation = true
--   - 이름 패턴: 더미_초진_% / 더미_재진_%
-- ============================================================
-- 실행: psql $DATABASE_URL < scripts/rollback_dummy_20260526.sql
-- 또는: node scripts/rollback_dummy_20260526.mjs  (백업 포함 안전 삭제)
-- ============================================================

BEGIN;

-- STEP 1: check_ins 삭제 (재진 과거체크인 36건 포함)
DELETE FROM check_ins
WHERE customer_id IN (
  SELECT id FROM customers
  WHERE created_by = 'dummy-seed-20260526'
    AND is_simulation = true
);

-- STEP 2: reservations 삭제 (72건)
DELETE FROM reservations
WHERE created_by = 'dummy-seed-20260526'
  AND reservation_date = '2026-05-26';

-- STEP 3: customers 삭제 (72건)
DELETE FROM customers
WHERE created_by = 'dummy-seed-20260526'
  AND is_simulation = true;

-- 검증 (실행 후 0건 확인)
-- SELECT count(*) FROM customers WHERE created_by = 'dummy-seed-20260526';
-- SELECT count(*) FROM reservations WHERE created_by = 'dummy-seed-20260526';

COMMIT;

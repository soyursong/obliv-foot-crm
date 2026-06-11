-- ROLLBACK: T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN
-- 20260611180000_closing_revenue_read_lock.sql 의 역적용.
-- 회수했던 SELECT 정책(over-open / coordinator / therapist)을 원상 복원.
--
-- 주의: 롤백 시 매출집계 over-exposure(누수) 재발 — 보안 회귀. 긴급 대응용으로만 사용.
-- 멱등: DROP POLICY IF EXISTS 후 재생성.

BEGIN;

-- ── daily_closings 복원 ──
-- over-open(true) 복원
DROP POLICY IF EXISTS daily_closings_read ON daily_closings;
CREATE POLICY daily_closings_read ON daily_closings
  FOR SELECT
  USING ( true );

-- therapist/technician read 복원
DROP POLICY IF EXISTS daily_closings_therapist_read ON daily_closings;
CREATE POLICY daily_closings_therapist_read ON daily_closings
  FOR SELECT
  USING ( is_therapist_or_technician() );

-- finance_read = coordinator 포함 원복
DROP POLICY IF EXISTS daily_closings_finance_read ON daily_closings;
CREATE POLICY daily_closings_finance_read ON daily_closings
  FOR SELECT
  USING ( is_consultant_or_above() OR is_coordinator_or_above() );
COMMENT ON POLICY daily_closings_finance_read ON daily_closings IS NULL;

-- ── closing_manual_payments 복원 ──
DROP POLICY IF EXISTS closing_manual_read ON closing_manual_payments;
CREATE POLICY closing_manual_read ON closing_manual_payments
  FOR SELECT
  USING ( true );
COMMENT ON POLICY closing_manual_read ON closing_manual_payments IS NULL;

COMMIT;

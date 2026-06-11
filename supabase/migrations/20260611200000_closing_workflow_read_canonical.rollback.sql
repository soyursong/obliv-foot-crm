-- ROLLBACK: T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN (policy_correction_jnz7)
-- 20260611200000_closing_workflow_read_canonical.sql 의 역적용.
-- canonical clinic-scoped read 를 원래(prod) over-open(true) SELECT 정책으로 복원.
--
-- 주의: 롤백 시 over-open(true) 재발 — 미승인 authenticated + 타 clinic read 누수 재현(보안 회귀).
--        긴급 대응(일마감 read 차단 사고 등)용으로만 사용.
-- 멱등: DROP POLICY IF EXISTS 후 재생성.

BEGIN;

-- ── daily_closings : canonical → over-open(true) 복원 ──
DROP POLICY IF EXISTS daily_closings_read ON daily_closings;
CREATE POLICY daily_closings_read ON daily_closings
  FOR SELECT
  USING ( true );
COMMENT ON POLICY daily_closings_read ON daily_closings IS NULL;

-- ── closing_manual_payments : canonical → over-open(true) 복원 ──
DROP POLICY IF EXISTS closing_manual_read ON closing_manual_payments;
CREATE POLICY closing_manual_read ON closing_manual_payments
  FOR SELECT
  USING ( true );
COMMENT ON POLICY closing_manual_read ON closing_manual_payments IS NULL;

COMMIT;

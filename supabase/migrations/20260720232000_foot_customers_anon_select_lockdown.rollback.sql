-- T-20260720-foot-AICC-ANON-PII-LEAK · AC3 (베이스 봉합 2/2) · ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- 롤백 = 정책·grant 원상 복원 (prod 실측 prior state, 2026-07-20):
--   · 정책 anon_select_customer_self_checkin: SELECT, role=anon, PERMISSIVE, USING (clinic_id IS NOT NULL).
--   · anon customers grant: SELECT.
-- ⚠ 이 롤백은 SEV-1 누출을 재-개방한다 — 배포 회귀 등 불가피 상황에서만 사용.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT SELECT ON public.customers TO anon;

DROP POLICY IF EXISTS anon_select_customer_self_checkin ON public.customers;
CREATE POLICY anon_select_customer_self_checkin ON public.customers
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (clinic_id IS NOT NULL);

COMMIT;

-- ============================================================================
-- T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW · ROLLBACK
--   is_approved_user() narrow 해제 → package_payments_read `USING (true)` 원복.
--   (over-open outlier 재개통 = exposure 재확대. RESTRICTIVE tenant_isolation 는 UP 에서
--    무접촉이므로 clinic 격리는 rollback 후에도 유지됨.)
--   완전가역: DROP self + CREATE USING(true) 로 before-image(2026-08-11) 복원.
-- ============================================================================
DROP POLICY IF EXISTS "package_payments_read" ON public.package_payments;

CREATE POLICY "package_payments_read" ON public.package_payments
  FOR SELECT TO authenticated
  USING (true);

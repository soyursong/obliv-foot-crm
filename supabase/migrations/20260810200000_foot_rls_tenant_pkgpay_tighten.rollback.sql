-- ============================================================================
-- DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN · ROLLBACK (DROP pair)
--   RESTRICTIVE tenant-isolation 봉인 해제 → cross-clinic 도달 재개통(취약 복원).
--   완전가역: permissive 6종은 UP 에서 무접촉 → DROP 1줄로 원상 복귀.
-- ============================================================================
DROP POLICY IF EXISTS "package_payments_tenant_isolation" ON public.package_payments;

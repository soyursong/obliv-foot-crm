-- ============================================================================
-- T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL · ROLLBACK (DROP 1줄)
--   RESTRICTIVE tenant-isolation 봉인 해제 → cross-clinic 도달 재개통(취약 복원).
--   완전가역: permissive 3종(select/insert/update)은 UP 에서 무접촉 → DROP 1줄로 원상 복귀.
-- ============================================================================
DROP POLICY IF EXISTS "timer_records_tenant_isolation" ON public.timer_records;

-- Rollback: T-20260504-foot-SELFCHECKIN-CRM-BUG RLS fix
-- 이전 상태 (20260426030000 적용 직후)로 복원

BEGIN;

-- 신규 확장 정책 제거
DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

-- 이전 restrictive 정책 복원 (status='registered'만 허용)
CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (clinic_id IS NOT NULL AND status = 'registered');

-- 원래의 anon_checkin_create (WITH CHECK true) 복원
-- (20260419000001_rls_policies.sql 최초 정의)
DROP POLICY IF EXISTS anon_checkin_create ON public.check_ins;
CREATE POLICY anon_checkin_create ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (true);

-- GRANT 취소
REVOKE EXECUTE ON FUNCTION public.next_queue_number(UUID, DATE) FROM anon;

COMMIT;

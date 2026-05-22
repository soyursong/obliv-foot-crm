-- T-20260522-foot-STAFF-REEXPAND: daily_closings SELECT RLS — staff/part_lead 재적용
-- 총괄 지시: "직원 리뷰 결과 확인하고 권한 풀어줘" (2026-05-22)
--
-- 배경:
--   T-20260520-foot-STAFF-DAILY-READ (commit efd06a7)로 추가된 daily_closings_staff_read 정책이
--   B안 전체 롤백(2026-05-21 20:30)으로 제거됨. 총괄 직원 리뷰 완료 후 재적용 지시.
--
--   참고: base 정책 daily_closings_read (SELECT, USING(true), 20260423000000_rls_role_policies.sql)가
--         이미 모든 authenticated 유저에게 SELECT 허용 중.
--         daily_closings_staff_read는 명시적 정책으로 감사 추적·가시성 확보 목적.
--
-- 수정 내용:
--   daily_closings_staff_read 정책 재생성 (DROP IF EXISTS + CREATE — idempotent)
--   → is_floor_staff() 기반: staff/part_lead/tm SELECT 허용
--   → INSERT/UPDATE/DELETE는 추가하지 않음 — admin/manager 전용 유지
--
-- 잠금 유지:
--   daily_closings_admin_all / daily_closings_write — 변경 없음 (admin/manager CRUD 유지)
--   stats, sales, accounts — 변경 없음
--
-- Rollback: 20260522090030_daily_closings_staff_select_rls_reapply.down.sql
-- Ticket:   T-20260522-foot-STAFF-REEXPAND
-- Ordered:  김주연 총괄 (2026-05-22)

BEGIN;

-- ============================================================
-- 1. is_floor_staff() 헬퍼 함수 (idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION is_floor_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','staff','part_lead','tm');
$$;

COMMENT ON FUNCTION is_floor_staff() IS
  'T-20260520-foot-STAFF-PERM-AUDIT 계열: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. daily_closings SELECT 정책 — staff/part_lead 재생성
-- ============================================================
DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;

CREATE POLICY daily_closings_staff_read ON daily_closings
  FOR SELECT TO authenticated
  USING (is_floor_staff());

COMMENT ON POLICY daily_closings_staff_read ON daily_closings IS
  'T-20260522-foot-STAFF-REEXPAND: staff/part_lead 일마감 열람 권한 재적용. is_floor_staff() 재사용. INSERT/UPDATE/DELETE는 추가하지 않음.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인용)
-- ============================================================
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='daily_closings'
--  ORDER BY cmd, policyname;
--
-- 기대 (SELECT 정책):
--   daily_closings_finance_read   | SELECT
--   daily_closings_read           | SELECT  (base 정책, USING(true))
--   daily_closings_staff_read     | SELECT  ← 신규
--   daily_closings_therapist_read | SELECT

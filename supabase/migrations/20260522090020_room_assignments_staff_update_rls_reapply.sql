-- T-20260522-foot-STAFF-REEXPAND: room_assignments UPDATE RLS — staff/part_lead 재적용
-- 총괄 지시: "직원 리뷰 결과 확인하고 권한 풀어줘" (2026-05-22)
--
-- 배경:
--   T-20260520-foot-STAFF-ROOM-ASSIGN (commit 583d9a9)로 추가된 room_assignments_staff_update 정책이
--   B안 전체 롤백(2026-05-21 20:15)으로 제거됨. 총괄 직원 리뷰 완료 후 재적용 지시.
--
-- 수정 내용:
--   room_assignments_staff_update 정책 재생성 (DROP IF EXISTS + CREATE — idempotent)
--   → is_floor_staff(): staff/part_lead 공간 배정 변경 허용
--   → admin/manager의 room_assignments_admin_all(ALL)과 OR 결합 — 무해
--
-- 잠금 유지: INSERT/DELETE는 기존 admin_all 정책만 허용
--
-- Rollback: 20260522090020_room_assignments_staff_update_rls_reapply.down.sql
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
-- 2. room_assignments UPDATE 정책 — staff/part_lead 재생성
-- ============================================================
DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;

CREATE POLICY room_assignments_staff_update ON room_assignments
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());

COMMENT ON POLICY room_assignments_staff_update ON room_assignments IS
  'T-20260522-foot-STAFF-REEXPAND: staff/part_lead 공간 배정 변경 허용 (재적용). is_floor_staff() 재사용.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인용)
-- ============================================================
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='room_assignments'
--  ORDER BY cmd, policyname;
--
-- 기대:
--   room_assignments_admin_all     | ALL
--   room_assignments_approved_read | SELECT
--   room_assignments_staff_update  | UPDATE  ← 신규

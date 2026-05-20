-- T-20260520-foot-STAFF-ROOM-ASSIGN: room_assignments UPDATE RLS — staff/part_lead 공간 배정 변경 권한
--
-- Root Cause:
--   20260426000000_rls_role_separation.sql 에서 room_assignments UPDATE 권한이
--   admin/manager 이상에게만 부여됨(room_assignments_admin_all).
--   staff · part_lead 역할은 SELECT(room_assignments_approved_read) 만 가능.
--
--   치료실 배정(공간 배정) 변경 시 → supabase UPDATE(room_assignments)
--   → RLS 차단 → silent 0-row (error: null) → 저장 실패
--   → 관리자 계정은 room_assignments_admin_all 정책으로 통과 → 정상.
--   → 스태프 계정(staff · part_lead) 전원 실패.
--
-- Fix:
--   1) is_floor_staff() 헬퍼 함수 (CREATE OR REPLACE — idempotent)
--      20260520000060_check_ins_staff_update_rls.sql 과 공유.
--      독립 배포 또는 선행 배포 여부 무관하게 안전.
--   2) room_assignments_staff_update 정책 추가
--      → is_floor_staff() (admin/manager/director/staff/part_lead/tm) 대상 UPDATE 허용
--      → 기존 room_assignments_admin_all 정책 변경 없음 (OR 결합)
--
-- AC:
--   AC-1: staff 계정으로 공간 배정 변경 → 저장 성공
--   AC-2: part_lead 계정으로 공간 배정 변경 → 저장 성공
--   AC-3: 기존 역할 공간 배정 기존 동작 유지 (회귀 없음)
--   AC-4: RLS 마이그레이션 SQL + 롤백 SQL 쌍 제출
--
-- Rollback: 20260521000040_room_assignments_staff_update_rls.down.sql
-- Ticket:   T-20260520-foot-STAFF-ROOM-ASSIGN
-- Applied:  2026-05-21

BEGIN;

-- ============================================================
-- 1. is_floor_staff() 헬퍼 함수 (idempotent)
--    → 20260520000060_check_ins_staff_update_rls.sql 과 동일 정의
--    → 두 파일 중 어느 쪽이 먼저 적용되어도 안전하도록 CREATE OR REPLACE
--    → admin/manager/director/staff/part_lead/tm 포함
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
  'T-20260520-foot-STAFF-PERM-AUDIT: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). 칸반 드래그 UPDATE + 체크인 INSERT + 공간 배정 UPDATE 권한 공용.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. room_assignments UPDATE 정책 — staff/part_lead 추가
-- ============================================================
-- 기존 정책 목록 (변경 없음):
--   room_assignments_admin_all     → admin/manager ALL (UPDATE 포함)
--   room_assignments_approved_read → 승인된 모든 사용자 SELECT
--
-- 신규 정책:
--   room_assignments_staff_update  → is_floor_staff() 대상 UPDATE 허용
--   is_floor_staff()는 admin/manager를 포함하나 이미 room_assignments_admin_all로 통과.
--   RLS 정책은 OR 결합 → 중복 적용 무해.

DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;

CREATE POLICY room_assignments_staff_update ON room_assignments
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='room_assignments'
--  ORDER BY cmd, policyname;
--
-- 기대 결과 (UPDATE cmd 행):
--   room_assignments_admin_all    | UPDATE | {authenticated}   (ALL 정책 — UPDATE 포함)
--   room_assignments_staff_update | UPDATE | {authenticated}   ← 신규
--
-- staff 계정으로 테스트:
--   UPDATE room_assignments
--      SET room_id = <room_uuid>
--    WHERE id = <assignment_uuid>
--      AND clinic_id = current_user_clinic_id();
--   → 성공 시 AC-1 통과
--
-- part_lead 계정으로 동일 확인 → AC-2 통과
--
-- admin 계정으로 UPDATE 시 기존 정책(room_assignments_admin_all) 유지 → AC-3 통과

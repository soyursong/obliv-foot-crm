-- T-20260520-foot-RBAC-MENU-EXPAND: consultant/coordinator/therapist 메뉴 권한 확장
--
-- 배경:
--   김주연 총괄 직접 요청. consultant/coordinator/therapist 3역할이 접근 못하는 메뉴를 대폭 열기.
--   FE 변경(AdminLayout.tsx NAV_ITEMS + App.tsx RoleGuard)과 세트.
--
-- DB 변경 범위:
--   daily_closings — therapist SELECT 정책 추가
--     현재: daily_closings_finance_read = is_consultant_or_above() OR is_coordinator_or_above()
--           consultant/coordinator는 이미 포함. therapist는 차단됨.
--     Fix:  daily_closings_therapist_read 정책 추가 → therapist SELECT 허용 (WRITE는 여전히 admin/manager만)
--
-- 기타 테이블 DB 변경 불필요:
--   packages       — packages_read: FOR SELECT authenticated USING(true) → therapist 이미 접근 가능
--   staff/rooms    — staff_approved_read/rooms_approved_read: is_approved_user() → 이미 접근 가능
--   services       — services_approved_read: is_approved_user() → 이미 접근 가능
--   clinics        — clinics_approved_read: is_approved_user() → 이미 접근 가능
--   (의사)진료도구 — 해당 테이블 RLS 별도 (FE RoleGuard만 변경)
--
-- Rollback: 20260520000080_rbac_menu_expand.down.sql
-- Ticket:   T-20260520-foot-RBAC-MENU-EXPAND
-- Applied:  2026-05-20

-- ============================================================
-- 1. daily_closings SELECT — therapist 추가
--    기존 daily_closings_finance_read: is_consultant_or_above() OR is_coordinator_or_above()
--    신규 daily_closings_therapist_read: is_therapist_or_technician() → SELECT 허용
--    WRITE(INSERT/UPDATE/DELETE)는 daily_closings_admin_all(is_admin_or_manager()) 유지
-- ============================================================

CREATE POLICY daily_closings_therapist_read ON daily_closings
  FOR SELECT TO authenticated
  USING (is_therapist_or_technician());

COMMENT ON POLICY daily_closings_therapist_read ON daily_closings IS
  'T-20260520-foot-RBAC-MENU-EXPAND: therapist/technician 일마감 페이지 조회 허용. WRITE는 admin/manager 전용 유지.';

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, roles, qual
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='daily_closings'
--  ORDER BY cmd, policyname;
--
-- 기대 결과:
--   daily_closings_admin_all     | ALL    → is_admin_or_manager()
--   daily_closings_finance_read  | SELECT → is_consultant_or_above() OR is_coordinator_or_above()
--   daily_closings_therapist_read| SELECT → is_therapist_or_technician()
--
-- SELECT is_therapist_or_technician();  -- therapist 계정으로 실행 시 true

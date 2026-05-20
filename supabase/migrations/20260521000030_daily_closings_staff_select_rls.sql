-- T-20260520-foot-STAFF-DAILY-READ: daily_closings SELECT RLS — staff/part_lead 일마감 열람 권한
--
-- 배경:
--   STAFF-PERM-AUDIT 결과: daily_closings 테이블이 staff/part_lead에 대해
--   완전 차단(SELECT/INSERT/UPDATE/DELETE 모두 없음).
--   staff가 당일 마감 현황을 참고하여 접수·안내해야 하는 상황에서 운영 불편.
--
-- 현재 daily_closings RLS 정책:
--   daily_closings_admin_all      → ALL      (is_admin_or_manager())
--   daily_closings_finance_read   → SELECT   (is_consultant_or_above() OR is_coordinator_or_above())
--   daily_closings_therapist_read → SELECT   (is_therapist_or_technician())  ← RBAC-MENU-EXPAND 추가
--   staff/part_lead               → 없음     ← 이번에 추가
--
-- 수정 내용:
--   1) is_floor_staff() CREATE OR REPLACE (idempotent)
--      → 20260520000060/0070/0090/20260521000020 등에서 이미 정의됨. 재확인용.
--      → admin/manager/director/staff/part_lead/tm 포함
--
--   2) daily_closings_staff_read 신규 SELECT 정책
--      → is_floor_staff() 기반: staff/part_lead/tm (+ admin/manager/director 포함 — 기존 ALL과 OR 결합, 무해)
--      → INSERT/UPDATE/DELETE는 추가하지 않음 — 일마감 생성·수정은 admin/manager 전용 유지
--
-- 기존 정책 (변경 없음):
--   daily_closings_admin_all      → ALL   admin/manager 전체 CRUD 유지
--   daily_closings_finance_read   → SELECT consultant/coordinator 유지
--   daily_closings_therapist_read → SELECT therapist 유지
--
-- 신규 정책:
--   daily_closings_staff_read     → SELECT is_floor_staff() (staff/part_lead/tm/admin/manager/director)
--
-- AC:
--   AC-1: staff 계정으로 일마감 화면 접근 → 당일 마감 데이터 열람 성공 (빈 화면 아님)
--   AC-2: part_lead 계정으로 일마감 열람 성공
--   AC-3: staff 계정으로 일마감 생성/수정/삭제 시도 시 거부 (읽기 전용)
--   AC-4: 기존 admin/manager 일마감 CRUD 동작 유지 (회귀 없음)
--   AC-5: RLS 마이그레이션 SQL + 롤백 SQL 쌍
--
-- Rollback: 20260521000030_daily_closings_staff_select_rls.down.sql
-- Ticket:   T-20260520-foot-STAFF-DAILY-READ
-- Applied:  2026-05-21

BEGIN;

-- ============================================================
-- 1. is_floor_staff() 헬퍼 함수 (idempotent CREATE OR REPLACE)
--    → 20260520000060/0070/0090/20260521000020에서 이미 정의됨.
--    → 다중 마이그레이션 간 순서 무관하도록 재확인 배치.
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
  'T-20260520-foot-STAFF-PERM-AUDIT 계열: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). 칸반 UPDATE·INSERT·SELECT 권한 공용. idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. daily_closings SELECT 정책 — staff/part_lead 추가
--    기존 정책 목록 (변경 없음):
--      daily_closings_admin_all      → ALL   (is_admin_or_manager())
--      daily_closings_finance_read   → SELECT (is_consultant_or_above() OR is_coordinator_or_above())
--      daily_closings_therapist_read → SELECT (is_therapist_or_technician())
--
--    신규 정책:
--      daily_closings_staff_read     → SELECT (is_floor_staff())
--    is_floor_staff()에 admin/manager가 포함되나 daily_closings_admin_all(ALL)과 OR 결합 — 무해.
-- ============================================================
DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;

CREATE POLICY daily_closings_staff_read ON daily_closings
  FOR SELECT TO authenticated
  USING (is_floor_staff());

COMMENT ON POLICY daily_closings_staff_read ON daily_closings IS
  'T-20260520-foot-STAFF-DAILY-READ: staff/part_lead/tm 일마감 열람 허용. is_floor_staff() 기반. WRITE(INSERT/UPDATE/DELETE)는 daily_closings_admin_all(admin/manager 전용) 유지.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='daily_closings'
--  ORDER BY cmd, policyname;
--
-- 기대 결과:
--   daily_closings_admin_all      | ALL    | is_admin_or_manager()
--   daily_closings_finance_read   | SELECT | is_consultant_or_above() OR is_coordinator_or_above()
--   daily_closings_staff_read     | SELECT | is_floor_staff()           ← 신규
--   daily_closings_therapist_read | SELECT | is_therapist_or_technician()
--
-- staff 계정으로 SELECT 테스트:
--   SELECT id, closing_date, total_revenue
--     FROM daily_closings
--    WHERE clinic_id = current_user_clinic_id()
--    ORDER BY closing_date DESC
--    LIMIT 5;
--   → staff 계정 실행 시 데이터 반환 기대 (이전: 0 row)
--
-- INSERT 거부 테스트 (AC-3):
--   INSERT INTO daily_closings (clinic_id, closing_date)
--   VALUES (current_user_clinic_id(), CURRENT_DATE);
--   → staff 계정 실행 시 RLS 거부 기대
--
-- SELECT is_floor_staff();  -- staff 계정으로 실행 시 true 기대

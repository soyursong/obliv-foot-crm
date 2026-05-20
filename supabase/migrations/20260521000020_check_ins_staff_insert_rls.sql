-- T-20260520-foot-STAFF-CHECKIN-INSERT: check_ins INSERT RLS — staff/part_lead 체크인 직접 등록 권한
--
-- Root Cause:
--   20260426000000_rls_role_separation.sql 에서 check_ins INSERT 권한이
--   consultant 이상(check_ins_consult_insert)과 coordinator 이상(check_ins_coord_insert)에만 부여됨.
--   staff · part_lead 역할은 SELECT(check_ins_approved_read) 만 가능.
--
--   접수 담당 staff 계정 → 신규 체크인 직접 등록 시
--   → RLS INSERT 정책 차단 → 등록 실패 → 운영 차질
--
-- Fix:
--   1) is_floor_staff() 헬퍼 함수 (CREATE OR REPLACE — idempotent)
--      20260520000060_check_ins_staff_update_rls.sql 과 공유. 함께 또는 독립 배포 모두 안전.
--   2) check_ins_staff_insert 정책 추가
--      → is_floor_staff() (admin/manager/director/staff/part_lead/tm) 대상 INSERT 허용
--      → 기존 INSERT 정책(consult_insert, coord_insert) 변경 없음 (OR 결합)
--
-- 관련:
--   - T-20260520-foot-CHECKIN-RLS-STAFF: check_ins UPDATE 정책 (별도 파일)
--   - CHECKIN-RLS-STAFF와 동시 배포 가능. 배포 순서 무관.
--
-- AC:
--   AC-1: staff 계정으로 신규 체크인 등록 → 성공
--   AC-2: part_lead 계정으로 신규 체크인 등록 → 성공
--   AC-3: 기존 역할(admin/manager/consultant/coordinator) 체크인 등록 회귀 없음
--   AC-4: 마이그레이션 SQL + 롤백 SQL 쌍 제출
--
-- Rollback: 20260521000020_check_ins_staff_insert_rls.down.sql
-- Ticket:   T-20260520-foot-STAFF-CHECKIN-INSERT
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
  'T-20260520-foot-STAFF-PERM-AUDIT: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). 칸반 드래그 UPDATE + 체크인 INSERT 권한 공용.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. check_ins INSERT 정책 — staff/part_lead 추가
-- ============================================================
-- 기존 정책 목록 (변경 없음):
--   check_ins_admin_all      → admin/manager ALL (INSERT 포함)
--   check_ins_consult_insert → consultant 이상 INSERT
--   check_ins_coord_insert   → coordinator 이상 INSERT
--
-- 신규 정책:
--   check_ins_staff_insert   → is_floor_staff() 대상 INSERT 허용
--   is_floor_staff()는 admin/manager를 포함하나 이미 check_ins_admin_all로 통과.
--   RLS 정책은 OR 결합 → 중복 적용 무해.

DROP POLICY IF EXISTS check_ins_staff_insert ON check_ins;

CREATE POLICY check_ins_staff_insert ON check_ins
  FOR INSERT TO authenticated
  WITH CHECK (is_floor_staff());

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='check_ins'
--  ORDER BY cmd, policyname;
--
-- 기대 결과 (INSERT cmd 행):
--   check_ins_consult_insert  | INSERT | {authenticated}
--   check_ins_coord_insert    | INSERT | {authenticated}
--   check_ins_staff_insert    | INSERT | {authenticated}  ← 신규
--
-- staff 계정으로 테스트:
--   INSERT INTO check_ins (clinic_id, customer_name, customer_phone, visit_type, status)
--   VALUES (current_user_clinic_id(), '테스트', '01000000000', 'new', 'registered');
--   → 성공 시 AC-1 통과

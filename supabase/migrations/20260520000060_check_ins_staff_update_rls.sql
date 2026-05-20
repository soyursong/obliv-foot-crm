-- T-20260520-foot-CHECKIN-RLS-STAFF: check_ins UPDATE RLS — staff/part_lead/tm 역할 추가
--
-- Root Cause:
--   20260426000000_rls_role_separation.sql 에서 check_ins UPDATE 권한이
--   admin/manager · consultant 이상 · coordinator 이상 · therapist/technician 에게만 부여됨.
--   staff · part_lead · tm 역할은 SELECT(check_ins_approved_read) 만 가능.
--
--   칸반 드래그 시 handleDragEnd() → supabase UPDATE(status/stage)
--   → RLS 차단 → silent 0-row (error: null) → optimistic UI 유지
--   → 이후 fetchCheckIns() 호출(Realtime·polling)로 DB 값 덮어쓰기
--   → 슬롯이 원래 위치로 되돌아오는 것처럼 보임.
--
--   admin/manager 계정은 check_ins_admin_all 정책으로 통과 → 정상.
--   스태프 계정 전원(staff·part_lead·tm) 실패.
--
-- Fix:
--   1) 신규 헬퍼 함수 is_floor_staff() 추가
--      → admin/manager/director/staff/part_lead/tm 역할 포함
--      → 기존 is_coordinator_or_above() 변경 없음 (사이드 이펙트 방지)
--   2) check_ins_staff_update 정책 추가
--      → is_floor_staff() 대상 UPDATE 허용
--      → 기존 5역할(admin/manager/consultant/coordinator/therapist) 정책 OR 결합 — 충돌 없음
--
-- AC:
--   AC-1: staff 계정 칸반 드래그 이동 정상 반영
--   AC-2: part_lead 계정 칸반 드래그 이동 정상 반영
--   AC-3: 기존 5역할(admin/manager/consultant/coordinator/therapist) 회귀 없음
--   AC-4: 마이그레이션 SQL + 롤백 SQL 쌍 제출
--
-- Rollback: 20260520000060_check_ins_staff_update_rls.down.sql
-- Ticket:   T-20260520-foot-CHECKIN-RLS-STAFF
-- Applied:  2026-05-20

BEGIN;

-- ============================================================
-- 1. is_floor_staff() 헬퍼 함수
--    → 칸반 조작 가능 운영 직원 (비임상 관리 직군 포함)
--    → admin/manager/director/staff/part_lead/tm
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
  'T-20260520-foot-CHECKIN-RLS-STAFF: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). 칸반 드래그 UPDATE 권한용.';

-- authenticated에게 EXECUTE 허용
GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. check_ins UPDATE 정책 — staff/part_lead/tm 추가
-- ============================================================
-- 기존 정책 목록 (변경 없음):
--   check_ins_admin_all     → admin/manager ALL
--   check_ins_consult_update→ consultant 이상 (자기배정 또는 미배정)
--   check_ins_coord_update  → coordinator 이상 (초기 단계만)
--   check_ins_therap_update → therapist/technician (자기배정 record만)
--
-- 신규 정책:
--   check_ins_staff_update  → is_floor_staff() 대상 UPDATE 허용
--   is_floor_staff()는 admin/manager를 포함하나, admin은 이미 check_ins_admin_all로 통과.
--   RLS 정책은 OR 결합 → 중복 적용은 무해함.

CREATE POLICY check_ins_staff_update ON check_ins
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
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
-- 기대 결과:
--   check_ins_staff_update | UPDATE | {authenticated}
--   → is_floor_staff() 적용 확인
--
-- SELECT is_floor_staff();  -- staff 계정으로 실행 시 true
-- SELECT is_floor_staff();  -- anon 으로 실행 시 permission denied

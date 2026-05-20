-- T-20260520-foot-CUSTOMER-SELECT-RLS: customers SELECT RLS — staff/part_lead/tm 명시적 추가
--
-- 현상:
--   초진 환자 칸반 카드 클릭 → 1번차트(CheckInDetailSheet) + 2번차트(CustomerChartSheet)
--   customer 정보 미로드. staff/part_lead/tm 계정 전원 동일.
--
-- 근본 원인 분석:
--   기존 customers_approved_read 정책 (is_approved_user() 기반) 이 이론상 커버해야 하나,
--   CHECKIN-RLS-STAFF 배포 이후 현장에서 재발 확인.
--   is_approved_user()는 user_profiles.approved=true 필요 — 일부 staff 계정에서
--   approved 플래그 미설정 시 false 반환 → SELECT 0-row → customer 데이터 미로드.
--
--   초진 동선 영향:
--     check_in.customer_id = NULL (접수 시 고객 미매칭) →
--     load() 에서 customer_phone 기반 customers SELECT 폴백 실행 →
--     RLS 차단 시 resolvedCustomerId 미설정 →
--     2번차트(CustomerChartSheet) 자동 오픈 불가
--     1번차트(CheckInDetailSheet) 고객정보 섹션 빈값
--
-- 수정 내용:
--   1) is_floor_staff() CREATE OR REPLACE (20260520000060에서 신규. 재확인용 idempotent)
--      → admin/manager/director/staff/part_lead/tm 포함
--      → 이미 존재하면 덮어쓰기 (사이드 이펙트 없음)
--
--   2) customers_staff_select 신규 SELECT 정책
--      → is_floor_staff() 기반: 역할 명시적 확인 + 기존 customers_approved_read 에 OR 결합
--      → 중복 적용 무해 (OR 결합 특성)
--
-- 기존 정책 목록 (변경 없음):
--   customers_admin_all    → admin/manager/director ALL
--   customers_approved_read→ is_approved_user() SELECT
--   customers_consult_update → is_consultant_or_above() UPDATE
--   customers_coord_insert → is_coordinator_or_above() OR is_consultant_or_above() INSERT
--   customers_coord_update → is_coordinator_or_above() UPDATE
--   customers_staff_update → is_floor_staff() UPDATE (T-20260520-foot-STAFF-CUSTOMER-UPDATE)
--
-- 신규 정책:
--   customers_staff_select → is_floor_staff() SELECT
--
-- AC:
--   AC-1: staff 초진 카드 클릭 → 1번차트 열림 (고객정보 로드)
--   AC-2: staff → 2번차트 열림 (resolvedCustomerId 설정)
--   AC-3: part_lead 동일 확인
--   AC-4: 기존 역할(admin/manager/consultant/coordinator/therapist) 회귀 없음
--   AC-5: 마이그레이션 + 롤백 SQL 쌍
--   AC-6: 초진 customer_id NULL + phone 기반 폴백 정상 동작
--
-- Rollback: 20260520000090_customers_staff_select_rls.down.sql
-- Ticket:   T-20260520-foot-CUSTOMER-SELECT-RLS
-- Applied:  2026-05-20

-- ============================================================
-- 1. is_floor_staff() 재확인 (idempotent CREATE OR REPLACE)
--    → 20260520000060에서 이미 추가됐으나, 해당 migration이
--      BEGIN/COMMIT 트랜잭션 내에 있어 DB 적용 여부 불확실한 경우 대비.
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
  'T-20260520-foot-CUSTOMER-SELECT-RLS: 운영 직원 판정 (admin/manager/director/staff/part_lead/tm). customers SELECT/UPDATE + check_ins UPDATE 권한용. idempotent.';

GRANT EXECUTE ON FUNCTION is_floor_staff() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_floor_staff() FROM anon, public;

-- ============================================================
-- 2. customers SELECT 정책 — staff/part_lead/tm 명시적 추가
--    기존 customers_approved_read (is_approved_user) 와 OR 결합
--    → 중복 적용 무해
-- ============================================================
DROP POLICY IF EXISTS customers_staff_select ON customers;

CREATE POLICY customers_staff_select ON customers
  FOR SELECT TO authenticated
  USING (is_floor_staff());

COMMENT ON POLICY customers_staff_select ON customers IS
  'T-20260520-foot-CUSTOMER-SELECT-RLS: staff/part_lead/tm/admin/manager/director 역할이 customers 행 SELECT 가능. is_floor_staff() 기반. customers_approved_read OR 결합 — belt-and-suspenders.';

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='customers'
--  ORDER BY cmd, policyname;
--
-- 기대: customers_staff_select | SELECT | is_floor_staff()
--
-- SELECT is_floor_staff();  -- staff 계정으로 실행 시 true
-- SELECT is_approved_user(); -- staff 계정으로 실행 시 true (approved=true 필요)
--
-- 초진 phone 기반 SELECT 검증:
-- SELECT id, name, phone FROM customers
--  WHERE clinic_id = '<clinic_uuid>'
--    AND phone ILIKE '%12345678%'
--  LIMIT 1;
-- → staff 계정으로 실행 시 1 row 반환 기대 (RLS 차단 시 0 row)

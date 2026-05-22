-- T-20260522-foot-STAFF-REEXPAND: customers UPDATE RLS — staff/part_lead 재적용
-- 총괄 지시: "직원 리뷰 결과 확인하고 권한 풀어줘" (2026-05-22)
--
-- 배경:
--   T-20260520-foot-STAFF-CUSTOMER-UPDATE (commit 40f13ed)로 추가된 customers_staff_update 정책이
--   B안 전체 롤백(2026-05-21)으로 제거됨. 총괄 직원 리뷰 완료 후 재적용 지시.
--
-- 수정 내용:
--   customers_staff_update 정책 재생성 (DROP IF EXISTS + CREATE — idempotent)
--   → is_floor_staff(): admin/manager/director/staff/part_lead/tm 대상 UPDATE 허용
--   → 민감 컬럼(rrn_enc, passport_number): FE canEditSensitive + SECURITY DEFINER RPC로 보호
--
-- 잠금 유지 (변경 없음):
--   stats, sales: admin/manager 전용 유지
--   accounts: admin 전용 유지
--
-- Rollback: 20260522090010_customers_staff_update_rls_reapply.down.sql
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
-- 2. customers UPDATE 정책 — staff/part_lead 재생성
-- ============================================================
DROP POLICY IF EXISTS customers_staff_update ON customers;

CREATE POLICY customers_staff_update ON customers
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());

COMMENT ON POLICY customers_staff_update ON customers IS
  'T-20260522-foot-STAFF-REEXPAND: staff/part_lead/tm 역할이 customers 행 UPDATE 가능 (재적용). is_floor_staff() 재사용. 민감 컬럼 보호: rrn_enc→SECURITY DEFINER RPC, passport_number→FE canEditSensitive.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인용)
-- ============================================================
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='customers' AND cmd='UPDATE'
--  ORDER BY policyname;
--
-- 기대:
--   customers_consult_update  | UPDATE
--   customers_coord_update    | UPDATE
--   customers_staff_update    | UPDATE  ← 신규

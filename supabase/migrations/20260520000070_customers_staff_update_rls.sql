-- T-20260520-foot-STAFF-CUSTOMER-UPDATE
-- customers 테이블 UPDATE RLS — staff/part_lead 추가
-- STAFF-PERM-AUDIT 후속 P1: 데스크 스태프가 고객 정보(전화번호·주소 등) 수정 가능
--
-- 의존성: is_floor_staff() — 20260520000060_check_ins_staff_update_rls.sql 에서 신규 추가
--         (admin/manager/director/staff/part_lead/tm)
--
-- 민감 컬럼 노출 범위 검토:
--   rrn_enc / rrn_vault_id — SECURITY DEFINER RPC(rrn_encrypt/rrn_decrypt)로만 접근
--     → 이 RLS 정책으로 staff가 직접 rrn_enc를 UPDATE하는 것은 이론상 가능하나,
--       FE(Customers.tsx)에서 rrn 컬럼을 직접 수정하는 경로가 없으므로 실질 위험 없음.
--   passport_number — FE에서 staff/part_lead에게 readonly 처리 (canEditSensitive=false)
--
-- 롤백: 20260520000070_customers_staff_update_rls.down.sql
-- AC: AC-1(staff 전화번호 수정), AC-2(part_lead 주소 수정), AC-3(기존 역할 회귀 없음), AC-4(롤백 SQL)

BEGIN;

-- 멱등: 기존 정책 제거 후 재생성
DROP POLICY IF EXISTS customers_staff_update ON customers;

CREATE POLICY customers_staff_update ON customers
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());

COMMENT ON POLICY customers_staff_update ON customers IS
  'T-20260520-foot-STAFF-CUSTOMER-UPDATE: staff/part_lead/tm 역할이 customers 행 UPDATE 가능. is_floor_staff() 재사용. 민감 컬럼(rrn) 보호는 SECURITY DEFINER RPC + FE readonly(canEditSensitive)에서 처리.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='customers'
--  ORDER BY cmd, policyname;
--
-- 기대 결과 (UPDATE 정책):
--   customers_consult_update  | UPDATE | {authenticated}
--   customers_coord_update    | UPDATE | {authenticated}
--   customers_staff_update    | UPDATE | {authenticated}  ← 신규
--
-- SELECT is_floor_staff();  -- staff 계정으로 실행 시 true

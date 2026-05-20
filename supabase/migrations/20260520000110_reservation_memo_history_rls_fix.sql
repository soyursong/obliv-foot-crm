-- T-20260520-foot-C2Z1-MEMO-ACTIVE
-- reservation_memo_history RLS 정책 수정 — clinic_isolation_rmh 버그 수정
--
-- Root Cause:
--   20260518000020_reservation_memo_history.sql 에서 clinic_isolation_rmh 정책이
--   (SELECT clinic_id FROM staff WHERE id = auth.uid()) 로 작성됨.
--   staff.id 는 gen_random_uuid() PRIMARY KEY이며 auth.uid()와 무관.
--   → 서브쿼리 항상 NULL 반환 → clinic_id = NULL 항상 false
--   → SELECT 0행 반환 + INSERT 차단 → 예약메모 영역 비활성 상태
--
-- Fix:
--   1) 깨진 clinic_isolation_rmh 정책 DROP
--   2) current_user_clinic_id() 기반 새 정책 추가 (is_approved_user() 포함)
--      current_user_clinic_id() = SELECT clinic_id FROM user_profiles WHERE id = auth.uid()
--   3) USING + WITH CHECK 명시적 분리 (SELECT/INSERT/UPDATE/DELETE 모두 커버)
--
-- AC:
--   AC-1: staff 계정으로 reservation_memo_history SELECT 정상 반환
--   AC-2: staff 계정으로 reservation_memo_history INSERT 성공 → 예약메모 추가 가능
--   AC-3: 다른 클리닉 데이터 열람/쓰기 차단 유지 (clinic 격리)
--
-- Rollback: 20260520000110_reservation_memo_history_rls_fix.down.sql
-- Ticket:   T-20260520-foot-C2Z1-MEMO-ACTIVE
-- Applied:  2026-05-20

-- ============================================================
-- 1. 깨진 정책 제거
-- ============================================================
DROP POLICY IF EXISTS clinic_isolation_rmh ON reservation_memo_history;

-- ============================================================
-- 2. 올바른 정책 생성
--    current_user_clinic_id() → user_profiles.clinic_id WHERE id = auth.uid()
--    is_approved_user()       → user_profiles.approved = true
-- ============================================================
CREATE POLICY rmh_clinic_access ON reservation_memo_history
  FOR ALL TO authenticated
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  )
  WITH CHECK (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY rmh_clinic_access ON reservation_memo_history IS
  'T-20260520-foot-C2Z1-MEMO-ACTIVE: clinic_isolation_rmh(staff.id = auth.uid 오류) 대체.
   is_approved_user() + current_user_clinic_id() 기반 격리. SELECT/INSERT/UPDATE/DELETE 모두 커버.';

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'reservation_memo_history';
--
-- 기대: rmh_clinic_access | ALL | is_approved_user() AND clinic_id = current_user_clinic_id()
--
-- staff 계정으로 실행:
-- SELECT count(*) FROM reservation_memo_history;  -- 0 이상 (RLS 통과)
-- INSERT INTO reservation_memo_history (reservation_id, clinic_id, content, created_by_name)
--   VALUES ('<valid_resv_id>', '<clinic_id>', '테스트', '테스트');  -- 성공 기대

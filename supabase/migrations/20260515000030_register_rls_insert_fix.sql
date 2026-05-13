-- ============================================================
-- T-20260515-foot-RLS-REGISTER-BUG: user_profiles 자가 등록 INSERT 정책 복구
-- ============================================================
-- 배경: 20260426000000_rls_role_separation.sql 적용 후
--       E.5 user_profiles 정책 재정의에 자가 INSERT 정책이 누락됨.
--       결과: Register.tsx(/register) 신규 가입 시 RLS 위반 오류 발생.
--
-- 수정: authenticated 사용자가 자기 자신의 프로필만 INSERT 가능하도록 정책 추가.
--       signUp() 호출 후 세션이 즉시 확립되므로 TO authenticated 충분.
-- ============================================================

-- 기존에 동명 정책이 있을 경우 충돌 방지 (idempotent)
DROP POLICY IF EXISTS allow_insert_own_profile ON user_profiles;

CREATE POLICY allow_insert_own_profile ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

COMMENT ON POLICY allow_insert_own_profile ON user_profiles
  IS 'T-20260515-foot-RLS-REGISTER-BUG: 자가 등록 시 본인 프로필만 INSERT 허용';

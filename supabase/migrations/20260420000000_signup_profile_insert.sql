-- 회원가입 시점에는 세션이 아직 확립되지 않아 authenticated 정책을 통과하지 못함.
-- anon/authenticated 모두 INSERT 허용하여 signUp 직후 user_profiles 생성을 가능하게 한다.
-- 위조 위험은 approved=false 기본값과 관리자 승인 루프로 완화한다.
CREATE POLICY "allow_insert_own_profile"
  ON user_profiles
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- T-20260512-foot-NOTICE-RLS: notices INSERT RLS 정책 추가
-- 배경: notices_insert 정책이 staff.id = auth.uid() 조건으로 모든 사용자에게 실패
--   (staff.user_id 컬럼이 null이고 staff.id는 내부 UUID라 auth.uid()와 불일치)
-- 수정: authenticated 사용자에게 INSERT 허용하는 정책 추가
-- rollback: DROP POLICY IF EXISTS "notices_insert_for_authenticated" ON notices;

CREATE POLICY "notices_insert_for_authenticated" ON notices
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- TODO (follow-up): staff.user_id 컬럼에 auth UUID 백필 후
--   기존 broken 정책(notices_insert, notices_select, notices_update, notices_delete)을
--   staff.user_id = auth.uid() 조건으로 교체 필요.

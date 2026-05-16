-- T-20260516-foot-NOTICE-SAVE-FAIL: notices SELECT/UPDATE/DELETE RLS 정책 수정
-- 배경: 20260511000030_notices.sql 에서 생성된 notices_select/update/delete 정책이
--   staff.id = auth.uid() 조건을 사용하는데, staff.id는 내부 UUID라 auth.uid()와 불일치.
--   → SELECT가 항상 0건 반환 → INSERT 후 fetchNotices()에서 새 공지가 보이지 않음
--   → 현장 증상: "공지사항 저장 안 됨"
-- 수정: SELECT/UPDATE/DELETE도 authenticated 사용자에게 허용
--   (INSERT는 20260512000020_notices_rls_insert_fix.sql 에서 이미 수정됨)
-- rollback: see 20260519000030_notices_rls_full_fix.down.sql

-- broken 정책 제거
DROP POLICY IF EXISTS "notices_select" ON public.notices;
DROP POLICY IF EXISTS "notices_update" ON public.notices;
DROP POLICY IF EXISTS "notices_delete" ON public.notices;

-- SELECT: authenticated 사용자에게 허용 (clinic_id 기반 필터는 애플리케이션 레이어에서 수행)
CREATE POLICY "notices_select_for_authenticated" ON public.notices
  FOR SELECT TO authenticated
  USING (true);

-- UPDATE: authenticated 사용자에게 허용
CREATE POLICY "notices_update_for_authenticated" ON public.notices
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: authenticated 사용자에게 허용
CREATE POLICY "notices_delete_for_authenticated" ON public.notices
  FOR DELETE TO authenticated
  USING (true);

-- TODO (follow-up): staff.user_id 컬럼에 auth UUID 백필 후
--   모든 정책을 staff.user_id = auth.uid() 조건으로 교체 (clinic 격리 강화)

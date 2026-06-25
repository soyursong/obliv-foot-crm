-- ROLLBACK — T-20260625-foot-CLINICMGMT-3TAB-DIRECTOR-RBAC part2
-- director write 확대를 원복: super_phrases write role set 을 admin,manager 로 복원(20260603060000 원형).
-- 데이터 mutation 0. 재실행 안전.

BEGIN;

DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;
CREATE POLICY "admin_write_super_phrases"
  ON public.super_phrases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

COMMIT;

-- ROLLBACK for 20260625113000_phrase_template_director_write_rls.sql
-- director 를 write role set 에서 제거 → {admin,manager} 원복 (NOTICE-SAVE-FAIL 이전 resting state).
-- 주의: 롤백 시 문지은(director)은 다시 3탭 write 불가 상태로 복귀.

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

DROP POLICY IF EXISTS "admin_write_phrase_templates" ON public.phrase_templates;
CREATE POLICY "admin_write_phrase_templates"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager')
        AND user_profiles.active = true
    )
  );

DROP POLICY IF EXISTS "admin_write_document_templates" ON public.document_templates;
CREATE POLICY "admin_write_document_templates"
  ON public.document_templates FOR ALL
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

-- ROLLBACK: T-20260702-foot-CLINICMGMT-DIRECTOR-EDIT-FIX
--   3 테이블 admin_write 정책을 정본 baseline {admin, manager} (director 제거)로 복원.
--   ★주의: 롤백 시 director(문지은 대표원장) 는 진료관리 3탭 write 재차단(락아웃 복귀) — FE canEditClinicMgmt
--     director-escape 와 어긋나 버튼 노출↔write 거부 UX. 롤백은 FE 롤백과 동반해야 함.
--   G1: 정확히 이전 {admin,manager} per-table 복원. staffarea_write_phrases / read 정책 무접촉.

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

COMMENT ON POLICY "admin_write_super_phrases" ON public.super_phrases IS
  'RLS write: admin,manager (prescription_sets 패턴). T-20260603-foot-RX-SUPER-PHRASE.';
COMMENT ON POLICY "admin_write_document_templates" ON public.document_templates IS
  'RLS write: admin,manager. 서류 템플릿 (풋센터).';
COMMENT ON POLICY "admin_write_phrase_templates" ON public.phrase_templates IS
  'RLS write: admin,manager. 상용구 (풋센터).';

COMMIT;

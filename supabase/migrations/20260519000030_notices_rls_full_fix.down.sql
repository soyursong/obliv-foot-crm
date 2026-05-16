-- rollback: 20260519000030_notices_rls_full_fix
-- broken 정책 복원 (롤백 시 다시 broken 상태가 되므로 주의)
DROP POLICY IF EXISTS "notices_select_for_authenticated" ON public.notices;
DROP POLICY IF EXISTS "notices_update_for_authenticated" ON public.notices;
DROP POLICY IF EXISTS "notices_delete_for_authenticated" ON public.notices;

-- 기존 broken 정책 복원
CREATE POLICY "notices_select" ON public.notices
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM public.staff WHERE id = auth.uid()
    )
  );

CREATE POLICY "notices_update" ON public.notices
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM public.staff WHERE id = auth.uid()
    )
  );

CREATE POLICY "notices_delete" ON public.notices
  FOR DELETE USING (
    clinic_id IN (
      SELECT clinic_id FROM public.staff WHERE id = auth.uid()
    )
  );

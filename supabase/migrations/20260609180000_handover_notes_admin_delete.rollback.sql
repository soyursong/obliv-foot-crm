-- ROLLBACK: T-20260609-foot-HANDOVER-ADMIN-DELETE
-- DELETE RLS 정책을 author_id = auth.uid() 단독(본인 한정)으로 원복.
-- (canon T-20260605-foot-HANDOVER-BOARD 의 원래 정책으로 복귀)

drop policy if exists "handover_notes_delete" on public.handover_notes;
create policy "handover_notes_delete" on public.handover_notes
  for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "handover_checklist_delete" on public.handover_checklist_items;
create policy "handover_checklist_delete" on public.handover_checklist_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id and hn.author_id = auth.uid()
    )
  );

-- ROLLBACK: T-20260630-foot-HANDOVER-DELETE-PERSIST
-- DELETE RLS 정책을 직전 상태(20260609180000 inline-subquery 버전)로 원복.
-- (회귀 의심 검증용 — 원복 시 동일 버그 재현 가능성 있음에 유의.)

drop policy if exists "handover_notes_delete" on public.handover_notes;
create policy "handover_notes_delete" on public.handover_notes
  for delete to authenticated
  using (
    author_id = auth.uid()
    or (select role from public.user_profiles where id = auth.uid()) in ('admin', 'manager')
  );

drop policy if exists "handover_checklist_delete" on public.handover_checklist_items;
create policy "handover_checklist_delete" on public.handover_checklist_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id
        and (
          hn.author_id = auth.uid()
          or (select role from public.user_profiles where id = auth.uid()) in ('admin', 'manager')
        )
    )
  );

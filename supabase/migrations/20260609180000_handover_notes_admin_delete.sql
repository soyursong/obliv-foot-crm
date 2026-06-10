-- T-20260609-foot-HANDOVER-ADMIN-DELETE: 인수인계 게시판 관리자(총괄) 타인 카드 삭제 허용
-- supersedes: T-20260605-foot-HANDOVER-BOARD AC-7 (삭제 본인 한정 → admin/manager 확장)
-- 요청: 김주연 총괄 (C0ATE5P6JTH)
-- rollback: see 20260609180000_handover_notes_admin_delete.rollback.sql
--
-- 변경 요지:
--  handover_notes.DELETE RLS = (author_id = auth.uid()) 단독
--    → (author_id = auth.uid() OR user_profiles.role IN ('admin','manager'))
--  체크리스트 자식 테이블 DELETE RLS도 부모 note 삭제 권한과 일관되게 갱신.
--  수정(UPDATE) 권한은 본 건 범위 외 — 본인 한정 유지(AC-5). UPDATE 정책은 손대지 않음.
--
-- role 컬럼: public.user_profiles.role (UserRole enum-text), auth.uid() = user_profiles.id.
--   contract 표준 role 8종 중 admin(시스템 관리자)/manager(지점장·총괄실장=총괄)이 관리자.

-- ── handover_notes: DELETE 정책 확장 ──────────────────────────────────────────
drop policy if exists "handover_notes_delete" on public.handover_notes;
create policy "handover_notes_delete" on public.handover_notes
  for delete to authenticated
  using (
    author_id = auth.uid()
    or (select role from public.user_profiles where id = auth.uid()) in ('admin', 'manager')
  );

-- ── handover_checklist_items: DELETE 정책 확장 (부모 note 권한과 일관, AC-6) ──
-- 부모 note 는 FK on delete cascade 이지만, UI가 자식을 직접 delete 하는 경로
-- (수정 시 전체 교체)도 있으므로 정책을 부모 삭제 권한과 동일하게 맞춘다.
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

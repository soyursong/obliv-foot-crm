-- T-20260630-foot-HANDOVER-DELETE-PERSIST: 인수인계 삭제 RLS 회귀 수정
-- 요청: 김주연 총괄 (C0ATE5P6JTH) — /admin/handover 삭제 후 새로고침 시 복구(DB DELETE 미반영)
-- supersedes: T-20260609-foot-HANDOVER-ADMIN-DELETE (20260609180000) 의 DELETE 정책
-- rollback: see 20260630184500_handover_notes_delete_role_canon.rollback.sql
--
-- ── 근본 원인 ────────────────────────────────────────────────────────────────
-- 20260609180000 가 도입한 DELETE 정책이 관리자 판정에 raw inline subquery 를 사용:
--     (select role from public.user_profiles where id = auth.uid()) in ('admin','manager')
--   문제 1) 'director'(대표원장)·관리 tier 누락 — 코드베이스 canon(memo: 20260624160000,
--           is_admin_or_manager(): 20260426000000)은 ('admin','manager','director') 를 관리자로 본다.
--           총괄 김주연의 운영 tier 가 위 2종 set 에 들지 않으면 USING 절 false → DELETE 0행.
--   문제 2) inline subquery 는 invoker(요청 사용자) 권한으로 user_profiles RLS 하에서 평가되어
--           SECURITY DEFINER 헬퍼(current_user_role/is_admin_or_manager)와 달리 취약·비일관.
--   → 둘 다 'DELETE 가 error 없이 0행' 을 유발. FE 가 0행을 성공처리(별도 수정)하면서
--     낙관적 UI 만 제거 → DB 잔존 → 새로고침 복구(현장 버그). 본 마이그는 (1) 원인을 제거.
--
-- ── 수정 요지 ────────────────────────────────────────────────────────────────
--   handover_notes / handover_checklist_items 의 DELETE 정책을
--   raw subquery → SECURITY DEFINER 헬퍼 is_admin_or_manager() 로 교체.
--   is_admin_or_manager() = is_approved_user() AND current_user_role() IN ('admin','manager','director').
--   (SECURITY DEFINER, search_path 고정 — user_profiles RLS 비의존. 코드베이스 전역 동일 패턴.)
--   삭제 권한 = (본인 author_id) OR is_admin_or_manager(). UPDATE 정책은 손대지 않음(본인 한정 유지).

-- ── handover_notes: DELETE 정책 canon 정렬 ───────────────────────────────────
drop policy if exists "handover_notes_delete" on public.handover_notes;
create policy "handover_notes_delete" on public.handover_notes
  for delete to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin_or_manager()
  );

-- ── handover_checklist_items: DELETE 정책 (부모 note 권한과 일관) ─────────────
drop policy if exists "handover_checklist_delete" on public.handover_checklist_items;
create policy "handover_checklist_delete" on public.handover_checklist_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id
        and (
          hn.author_id = auth.uid()
          or public.is_admin_or_manager()
        )
    )
  );

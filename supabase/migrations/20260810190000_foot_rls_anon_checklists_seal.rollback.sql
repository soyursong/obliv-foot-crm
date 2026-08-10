-- ============================================================================
-- T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT · DOWN (rollback)
--   UP 의 정확한 역연산 = restrictive anon-deny 정책 DROP x2 (read + write).
--   ADDITIVE 봉쇄였으므로 permissive(anon_checklist_read / anon_checklist_write) 는
--   UP 에서 무접촉 → 복원 대상 없음 (DROP 만으로 before-image 완전 복귀).
--   authenticated 정책 6종 · SECDEF fn_complete_prescreen_checklist 도 UP 무접촉 → 복원 불요.
--   데이터 mutation 0 · 비파괴 · 멱등(IF EXISTS).
--   ⚠ rollback = anon-도달 미인증 PHI read+write 재개통(누수 재개방) — 사고 대응
--     (정당 anon 회귀 오판·셀프체크인 SECDEF write 회귀) 시에만. 발동 시 즉시 FOLLOWUP → planner/DA 재판정.
-- ============================================================================
DROP POLICY IF EXISTS "checklists_anon_read_deny"  ON public.checklists;
DROP POLICY IF EXISTS "checklists_anon_write_deny" ON public.checklists;

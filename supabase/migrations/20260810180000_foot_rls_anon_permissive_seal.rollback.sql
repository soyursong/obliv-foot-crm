-- ============================================================================
-- T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL · DOWN (rollback)
--   UP 의 정확한 역연산 = restrictive anon-deny 정책 DROP (1줄/테이블).
--   ADDITIVE 봉쇄였으므로 permissive(anon_service_read / anon_read_package_tiers) 는
--   UP 에서 무접촉 → 복원 대상 없음 (DROP 만으로 before-image 완전 복귀).
--   데이터 mutation 0 · 비파괴 · 멱등(IF EXISTS).
--   ⚠ rollback = anon-도달 미인증 READ 재개통(보안홀 재개방) — 사고 대응(정당 anon 회귀 오판) 시에만.
--     발동 시 즉시 FOLLOWUP → planner/DA 재판정.
-- ============================================================================
DROP POLICY IF EXISTS "services_anon_deny"      ON public.services;
DROP POLICY IF EXISTS "package_tiers_anon_deny" ON public.package_tiers;

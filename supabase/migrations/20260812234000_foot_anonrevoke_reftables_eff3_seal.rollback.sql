-- ============================================================================
-- T-20260812-foot-ANONREVOKE-REFTABLES-EFF3 · DOWN (rollback)
--   UP 의 정확한 역연산 = restrictive anon-deny 정책 DROP (1줄/테이블).
--   ADDITIVE SEAL 였으므로 permissive(redpay_terminal_registry_read_all / form_templates_read /
--   room_role_read) 는 UP 에서 무접촉 → 복원 대상 없음(DROP 만으로 before-image 완전 복귀).
--   데이터 mutation 0 · 비파괴 · 멱등(IF EXISTS).
--   ⚠ rollback = anon EFFECTIVE(live-leak) 재개통(POS/단말 config·양식·룸매핑 anon 재노출).
--     사고 대응(정당 anon 회귀 오판) 시에만 발동. 발동 시 즉시 FOLLOWUP → planner/DA 재판정.
-- ============================================================================
DROP POLICY IF EXISTS "redpay_terminal_registry_anon_deny" ON public.redpay_terminal_registry;
DROP POLICY IF EXISTS "form_templates_anon_deny"           ON public.form_templates;
DROP POLICY IF EXISTS "room_role_mapping_anon_deny"        ON public.room_role_mapping;

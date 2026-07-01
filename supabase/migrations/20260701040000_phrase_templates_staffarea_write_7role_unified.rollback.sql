-- Rollback: T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE shape(ii)
-- 단일 통합정책만 제거. admin_write_phrase_templates({admin,manager,director})는 본 마이그가 건드린 적
-- 없으므로 복원 불필요. 제거 후 effective write = {admin,manager,director}만(드리프트 前 PROD 원상).
-- superseded 정책(staff_write_staffarea_phrases / coordinator_write_staffarea_phrases)은 흡수·폐기 대상
-- 이므로 rollback에서 재생성하지 않음(의도된 폐기). 데이터 영향 0.

DROP POLICY IF EXISTS "staffarea_write_phrases" ON public.phrase_templates;

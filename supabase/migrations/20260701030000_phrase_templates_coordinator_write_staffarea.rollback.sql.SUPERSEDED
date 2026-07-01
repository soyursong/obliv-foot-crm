-- Rollback: T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS
-- 신규 permissive 정책만 제거. 기존 admin_write_phrase_templates({admin,manager,director}) 는
-- 본 마이그가 건드린 적 없으므로 복원 불필요.
-- 제거 후 effective write = {admin, manager, director} 만(원상 복귀). 데이터 영향 0.

DROP POLICY IF EXISTS "coordinator_write_staffarea_phrases" ON public.phrase_templates;

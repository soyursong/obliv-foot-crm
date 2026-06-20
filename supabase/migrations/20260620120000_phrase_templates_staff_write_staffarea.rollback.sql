-- Rollback: T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK AC-3
-- 신규 permissive 정책만 제거. 기존 admin_write_phrase_templates 는 본 마이그가 건드린 적 없으므로 복원 불필요.
-- 제거 후 effective write = {admin, manager} 만(원상 복귀). 데이터 영향 0.

DROP POLICY IF EXISTS "staff_write_staffarea_phrases" ON public.phrase_templates;

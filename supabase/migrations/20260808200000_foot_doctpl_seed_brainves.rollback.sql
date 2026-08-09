-- ROLLBACK: T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA
-- 본 마이그가 INSERT한 T1 '뇌혈관약' 서류 템플릿 1행 제거(ADDITIVE 되돌림).
-- 무DDL. 기존 다른 템플릿 무접촉.

DELETE FROM public.document_templates
WHERE document_type = 'opinion'
  AND name = '뇌혈관약';

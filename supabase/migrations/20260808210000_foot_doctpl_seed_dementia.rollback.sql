-- ROLLBACK: T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA (T2 치매약)
-- 본 마이그가 INSERT한 T2 '치매약' 서류 템플릿 1행 제거(ADDITIVE 되돌림).
-- 무DDL. 기존 다른 템플릿(뇌혈관약 등) 무접촉.

DELETE FROM public.document_templates
WHERE document_type = 'opinion'
  AND name = '치매약';

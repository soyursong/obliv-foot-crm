-- ROLLBACK T-20260603-foot-RX-CHART-FOLLOWUP2 #2: 서류템플릿 카테고리 컬럼 제거
-- 주의: category/subcategory 분류 정보 전부 소실(라벨 텍스트). 롤백 전 백업 권장.
-- document_type(진단서/소견서 enum) 본축은 무영향 — 카테고리는 직교 추가 분류축이었음.
DROP INDEX IF EXISTS public.idx_doc_templates_category;
ALTER TABLE public.document_templates
  DROP COLUMN IF EXISTS subcategory,
  DROP COLUMN IF EXISTS category;

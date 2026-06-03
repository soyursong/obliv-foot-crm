-- T-20260603-foot-RX-CHART-FOLLOWUP2 #2: 서류템플릿 2단계 카테고리 위계
-- 문지은 대표원장 요청(#2): 서류템플릿을 2-depth 카테고리로 분류
--   (예: `레이저진단서` > `위장장애`).
--
-- 저장구조 = document_templates 에 category / subcategory TEXT 컬럼 추가 (둘 다 nullable).
--   NULL = 미분류. 별도 카테고리 테이블 대신 컬럼 채택 근거:
--   - 카테고리는 자유 라벨(현장이 즉석 생성) · 참조무결성 요구 없음 · 템플릿 수 소규모.
--   - 신규 테이블/FK 도입 = blast radius↑. 컬럼 2개 = additive 100%, 롤백 = DROP COLUMN.
--   - 기존 document_type(진단서/소견서/…) enum 은 그대로 보존 — 카테고리는 직교(추가 분류축).
--
-- additive · 멱등(ADD COLUMN IF NOT EXISTS). 레거시(기존 템플릿) 무영향(category=NULL=미분류).
-- supervisor 리뷰 · dev-foot 직접 마이그.

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS category    TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

COMMENT ON COLUMN public.document_templates.category IS
  '#2 서류 1단계 카테고리 (nullable, NULL=미분류). 예: 레이저진단서';
COMMENT ON COLUMN public.document_templates.subcategory IS
  '#2 서류 2단계 하위 카테고리 (nullable, NULL=미분류). 예: 위장장애. category 하위에서만 의미.';

-- 그룹 정렬·조회 가속(선택적). 카테고리 단위 그룹핑 쿼리 흔함.
CREATE INDEX IF NOT EXISTS idx_doc_templates_category
  ON public.document_templates(category, subcategory);

-- 재실행 안전: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

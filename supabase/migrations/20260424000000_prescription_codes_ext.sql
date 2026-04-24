-- T-20260423-foot-RX-CODE-SEED (1) 스키마 확장
-- 형님 요구: 수가(원) 컬럼 + 자체 사용 코드 허용
--
-- 추가 컬럼:
--   price_krw    NUMERIC(10,0) — 실제 수가 (원). NULL 허용 (수동 입력 전)
--   code_source  TEXT CHECK IN ('official','custom') — 공식/자체 구분
--
-- 대표 승인 후 Supabase SQL editor 또는 Management API apply.

ALTER TABLE prescription_codes
  ADD COLUMN IF NOT EXISTS price_krw    NUMERIC(10,0),
  ADD COLUMN IF NOT EXISTS code_source  TEXT NOT NULL DEFAULT 'official'
    CHECK (code_source IN ('official','custom'));

CREATE INDEX IF NOT EXISTS idx_prescription_codes_source
  ON prescription_codes(code_source);

-- 재실행 안전: DEFAULT 'official' + IF NOT EXISTS.

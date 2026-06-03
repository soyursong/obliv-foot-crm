-- T-20260603-foot-RX-CHART-ENHANCE AC-1: 처방세트 폴더링
-- prescription_sets.folder TEXT nullable (additive · 레거시 무영향)
--   NULL = 미분류. 동일 folder 문자열로 그룹핑(폴더) UI 구성.
-- supervisor 리뷰 · dev-foot 직접 마이그.

ALTER TABLE prescription_sets
  ADD COLUMN IF NOT EXISTS folder TEXT;

COMMENT ON COLUMN prescription_sets.folder IS
  'AC-1 처방세트 폴더명 (nullable). NULL=미분류. 동일 문자열로 그룹핑.';

-- 재실행 안전: ADD COLUMN IF NOT EXISTS.

-- ROLLBACK T-20260603-foot-RX-CHART-ENHANCE AC-1: prescription_sets.folder 제거
-- 주의: folder 값이 입력된 후 롤백 시 분류 정보 소실. 롤백 전 백업 권장.
ALTER TABLE prescription_sets
  DROP COLUMN IF EXISTS folder;

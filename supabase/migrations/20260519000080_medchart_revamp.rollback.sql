-- ROLLBACK: T-20260519-foot-MEDCHART-REVAMP
-- 신규 컬럼만 제거 — 기존 데이터 영향 없음

ALTER TABLE medical_charts
  DROP COLUMN IF EXISTS clinical_progress,
  DROP COLUMN IF EXISTS prescription_items;

DROP INDEX IF EXISTS idx_pt_shortcut_key;

ALTER TABLE phrase_templates
  DROP COLUMN IF EXISTS shortcut_key;

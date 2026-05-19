-- T-20260519-foot-MEDCHART-REVAMP: 진료차트 전면 보강
-- AC-3: 임상경과(clinical_progress) + 처방내역(prescription_items) 신규 컬럼
-- AC-3: phrase_templates에 shortcut_key 단축어 컬럼 추가
-- rollback: 20260519000080_medchart_revamp.rollback.sql
-- risk: NO existing data modification — 신규 컬럼 (nullable), 기존 rows 영향 없음

-- 1. medical_charts: 임상경과, 처방내역 컬럼 추가
ALTER TABLE medical_charts
  ADD COLUMN IF NOT EXISTS clinical_progress   TEXT,
  ADD COLUMN IF NOT EXISTS prescription_items  JSONB DEFAULT NULL;

COMMENT ON COLUMN medical_charts.clinical_progress IS
  '임상경과 — phrase_templates 상용구 불러오기 지원 (T-20260519-foot-MEDCHART-REVAMP)';
COMMENT ON COLUMN medical_charts.prescription_items IS
  '처방내역 JSONB — prescription_sets 세트 불러오기 지원 (T-20260519-foot-MEDCHART-REVAMP)';

-- 2. phrase_templates: shortcut_key 단축어 컬럼 추가
ALTER TABLE phrase_templates
  ADD COLUMN IF NOT EXISTS shortcut_key TEXT DEFAULT NULL;

COMMENT ON COLUMN phrase_templates.shortcut_key IS
  '임상경과 단축어 (#key 입력 시 자동완성) — T-20260519-foot-MEDCHART-REVAMP';

-- shortcut_key 검색 인덱스
CREATE INDEX IF NOT EXISTS idx_pt_shortcut_key
  ON phrase_templates (shortcut_key)
  WHERE shortcut_key IS NOT NULL;

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'medical_charts' AND column_name = 'clinical_progress'
  ) THEN
    RAISE EXCEPTION 'medical_charts.clinical_progress 컬럼 추가 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'medical_charts' AND column_name = 'prescription_items'
  ) THEN
    RAISE EXCEPTION 'medical_charts.prescription_items 컬럼 추가 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'phrase_templates' AND column_name = 'shortcut_key'
  ) THEN
    RAISE EXCEPTION 'phrase_templates.shortcut_key 컬럼 추가 실패';
  END IF;
END $$;

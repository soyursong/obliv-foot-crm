-- T-20260526-foot-PHRASE-SLASH
-- AC-1: phrase_templates.shortcut_key UNIQUE 제약 강화
-- 기존: 일반 인덱스 (idx_pt_shortcut_key) → UNIQUE 인덱스 (idx_pt_shortcut_key_unique)
-- NULL 허용: partial index (WHERE shortcut_key IS NOT NULL) → 복수 NULL 공존 가능
-- rollback: 20260526150000_phrase_shortcut_unique.rollback.sql
-- risk: 기존 데이터 중 shortcut_key 중복 행이 있으면 실패 — 신규 컬럼이라 실제 데이터 없음

-- 기존 일반 인덱스 제거
DROP INDEX IF EXISTS idx_pt_shortcut_key;

-- UNIQUE 인덱스 생성 (NULL 허용 partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_shortcut_key_unique
  ON phrase_templates (shortcut_key)
  WHERE shortcut_key IS NOT NULL;

COMMENT ON INDEX idx_pt_shortcut_key_unique IS
  'shortcut_key 전역 unique (NULL 허용) — T-20260526-foot-PHRASE-SLASH';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'phrase_templates'
       AND indexname  = 'idx_pt_shortcut_key_unique'
  ) THEN
    RAISE EXCEPTION 'idx_pt_shortcut_key_unique 생성 실패';
  END IF;
END $$;

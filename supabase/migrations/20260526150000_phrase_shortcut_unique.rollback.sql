-- T-20260526-foot-PHRASE-SLASH 롤백
-- UNIQUE 인덱스 제거 후 기존 일반 인덱스 복원

DROP INDEX IF EXISTS idx_pt_shortcut_key_unique;

CREATE INDEX IF NOT EXISTS idx_pt_shortcut_key
  ON phrase_templates (shortcut_key)
  WHERE shortcut_key IS NOT NULL;

-- T-20260526-foot-MEDCHART-SYNC 롤백: phrase_type 컬럼 제거
ALTER TABLE phrase_templates DROP CONSTRAINT IF EXISTS chk_phrase_templates_type;
DROP INDEX IF EXISTS idx_phrase_templates_phrase_type;
ALTER TABLE phrase_templates DROP COLUMN IF EXISTS phrase_type;

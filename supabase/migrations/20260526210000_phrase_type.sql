-- T-20260526-foot-MEDCHART-SYNC: phrase_templates에 phrase_type 컬럼 추가
-- 펜차트 상용구(기존) / 진료차트 상용구(신규) 분리
-- 롤백: 20260526210000_phrase_type.rollback.sql

ALTER TABLE phrase_templates
  ADD COLUMN IF NOT EXISTS phrase_type TEXT NOT NULL DEFAULT 'pen_chart';

COMMENT ON COLUMN phrase_templates.phrase_type IS
  'pen_chart(펜차트 상용구) | medical_chart(진료차트 상용구) — T-20260526-foot-MEDCHART-SYNC';

-- 기존 rows를 모두 pen_chart로 명시적 설정 (backward compat)
UPDATE phrase_templates
  SET phrase_type = 'pen_chart'
 WHERE phrase_type IS NULL OR phrase_type NOT IN ('pen_chart', 'medical_chart');

-- CHECK constraint
ALTER TABLE phrase_templates
  DROP CONSTRAINT IF EXISTS chk_phrase_templates_type;
ALTER TABLE phrase_templates
  ADD CONSTRAINT chk_phrase_templates_type
    CHECK (phrase_type IN ('pen_chart', 'medical_chart'));

-- 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_phrase_templates_phrase_type
  ON phrase_templates (phrase_type)
  WHERE phrase_type IS NOT NULL;

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'phrase_templates' AND column_name = 'phrase_type'
  ) THEN
    RAISE EXCEPTION 'phrase_templates.phrase_type 컬럼 추가 실패';
  END IF;
END $$;

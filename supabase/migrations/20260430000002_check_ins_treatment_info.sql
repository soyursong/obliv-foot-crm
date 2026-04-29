-- T-20260430-foot-TREATMENT-LABEL
-- check_ins 진료정보 필드 추가
-- 상담유무 / 치료종류 / 프리컨디셔닝 / 포도듈 / 레이저시간

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS consultation_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS treatment_kind text,
  ADD COLUMN IF NOT EXISTS preconditioning_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pododulle_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS laser_minutes integer;

COMMENT ON COLUMN check_ins.consultation_done IS '상담 완료 여부';
COMMENT ON COLUMN check_ins.treatment_kind IS '치료종류 (가열레이저/비가열레이저/프컨+레이저/수액/상담/기타)';
COMMENT ON COLUMN check_ins.preconditioning_done IS '프리컨디셔닝(프컨) 적용 여부';
COMMENT ON COLUMN check_ins.pododulle_done IS '포도듈(포돌) 부착 여부';
COMMENT ON COLUMN check_ins.laser_minutes IS '레이저 조사 시간 (분)';

-- rollback:
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS consultation_done;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS treatment_kind;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS preconditioning_done;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS pododulle_done;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS laser_minutes;

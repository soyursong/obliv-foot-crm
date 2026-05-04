-- T-20260502-foot-STATUS-COLOR-FLAG ROLLBACK
-- status_flag / status_flag_history 컬럼 제거

DROP POLICY IF EXISTS check_ins_flag_update ON check_ins;

ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_flag_valid;
ALTER TABLE check_ins DROP COLUMN IF EXISTS status_flag;
ALTER TABLE check_ins DROP COLUMN IF EXISTS status_flag_history;

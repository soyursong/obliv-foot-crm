-- Rollback: T-20260603-foot-STATUSFLAG-BROWN
-- 'brown' 제거 → 원래 9값 constraint 복원.
-- 주의: rollback 전 brown 사용 row 가 있으면 constraint 위반.
--   UPDATE check_ins SET status_flag = NULL WHERE status_flag = 'brown';  -- 필요 시 선실행

ALTER TABLE check_ins
  DROP CONSTRAINT IF EXISTS check_ins_status_flag_valid;

ALTER TABLE check_ins
  ADD CONSTRAINT check_ins_status_flag_valid CHECK (
    status_flag IS NULL OR status_flag IN (
      'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'dark_gray'
    )
  );

COMMENT ON COLUMN check_ins.status_flag IS
  '상태 플래그 (카드 배경색): white=정상/red=취소부도/orange=CP데스크/yellow=HL/green=선체험/blue=CP치료실/purple=진료필요/pink=진료완료/dark_gray=수납완료';

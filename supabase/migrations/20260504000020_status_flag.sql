-- T-20260502-foot-STATUS-COLOR-FLAG
-- 고객 상태 플래그: 카드 배경색 변경 (9가지) + 변경 이력(audit)
-- 2026-05-04 dev-foot

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS status_flag TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS status_flag_history JSONB DEFAULT '[]'::jsonb;

-- 유효값 제약
ALTER TABLE check_ins
  ADD CONSTRAINT check_ins_status_flag_valid CHECK (
    status_flag IS NULL OR status_flag IN (
      'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'dark_gray'
    )
  );

COMMENT ON COLUMN check_ins.status_flag IS
  '상태 플래그 (카드 배경색): white=정상/red=취소부도/orange=CP데스크/yellow=HL/green=선체험/blue=CP치료실/purple=진료필요/pink=진료완료/dark_gray=수납완료';

COMMENT ON COLUMN check_ins.status_flag_history IS
  '상태 플래그 변경 이력 (audit): [{flag, changed_at, changed_by}]';

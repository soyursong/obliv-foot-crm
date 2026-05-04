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

-- ---------------------------------------------------------------
-- RLS: 코디/치료사도 모든 단계에서 status_flag 변경 허용
-- 배경: check_ins_coord_update 는 status IN (registered/checklist/exam_waiting)만
--       허용하므로, 시술·결제 단계 환자에 대해 코디가 status_flag(CP치료실/수납완료 등)
--       변경 시 RLS 차단 → 현장 운영 불가.
-- 해결: 별도 UPDATE 정책 추가 (Option A — 기존 정책 유지, 신규 정책 추가)
-- 주의: PostgreSQL RLS는 컬럼 레벨 제약 미지원 → 정책 단순화 (status_flag만 변경하도록 앱에서 제한)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS check_ins_flag_update ON check_ins;
CREATE POLICY check_ins_flag_update ON check_ins
  FOR UPDATE TO authenticated
  USING (is_coordinator_or_above())
  WITH CHECK (is_coordinator_or_above());

-- T-20260502-foot-HEATED-LASER-SLOT — 롤백 SQL
-- room_assignments.room_type CHECK constraint에서 'heated_laser' 제거

-- 0) 기존 heated_laser 배정 데이터 삭제 (롤백 전 정리)
DELETE FROM room_assignments WHERE room_type = 'heated_laser';

-- 1) 신규 constraint 제거
ALTER TABLE room_assignments DROP CONSTRAINT IF EXISTS room_assignments_room_type_check;

-- 2) 원래 constraint 복원 (heated_laser 미포함)
ALTER TABLE room_assignments ADD CONSTRAINT room_assignments_room_type_check
  CHECK (room_type IN (
    'treatment',
    'laser',
    'consultation',
    'examination'
  ));

-- 3) 코멘트 복원
COMMENT ON COLUMN room_assignments.room_type IS
  'room 유형: treatment/laser/consultation/examination.';

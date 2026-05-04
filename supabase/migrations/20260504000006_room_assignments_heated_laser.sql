-- T-20260502-foot-HEATED-LASER-SLOT
-- room_assignments.room_type CHECK constraint에 'heated_laser' 추가
--
-- 변경사항:
--   - room_assignments.room_type CHECK constraint에 'heated_laser' 추가
--   - 가열성레이저 슬롯 원장님 배정 저장 지원
--   - 기존 데이터(treatment/laser/consultation/examination) 영향 없음

-- 1) 기존 CHECK constraint 제거
ALTER TABLE room_assignments DROP CONSTRAINT IF EXISTS room_assignments_room_type_check;

-- 2) 신규 CHECK constraint 추가 (heated_laser 포함 5종)
ALTER TABLE room_assignments ADD CONSTRAINT room_assignments_room_type_check
  CHECK (room_type IN (
    'treatment',     -- 치료실
    'laser',         -- 레이저실
    'consultation',  -- 상담실
    'examination',   -- 진료실(원장실)
    'heated_laser'   -- 가열성레이저 슬롯 (T-20260502-foot-HEATED-LASER-SLOT)
  ));

-- 3) 코멘트 갱신
COMMENT ON COLUMN room_assignments.room_type IS
  'room 유형: treatment/laser/consultation/examination/heated_laser. heated_laser = 가열성레이저 슬롯 원장님 배정 (2026-05-04).';

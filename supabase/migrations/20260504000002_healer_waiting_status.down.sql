-- T-20260502-foot-HEALER-WAIT-SLOT 롤백
-- 힐러대기(healer_waiting) 상태 제거 → CHECK constraint 이전 버전 복구
--
-- 주의: healer_waiting 상태 레코드가 존재하면 laser_waiting으로 이동 후 constraint 제거

-- 1) healer_waiting → laser_waiting (활성 레코드 이동)
UPDATE check_ins
SET status = 'laser_waiting'
WHERE status = 'healer_waiting';

-- 2) CHECK constraint 이전 버전으로 복구 (healer_waiting 제외 12개)
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',
    'consult_waiting',
    'consultation',
    'exam_waiting',
    'examination',
    'treatment_waiting',
    'preconditioning',
    'laser_waiting',
    'laser',
    'payment_waiting',
    'done',
    'cancelled'
  ));

-- 3) 컬럼 코멘트 이전 버전으로 복구
COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (v2 2026-04-30): 신규 12단계 / 재진 7단계. laser_waiting = 레이저실 입실 전 대기. payment_waiting = 시술 후 수납대기.';

-- T-20260430-foot-STAGE-FLOW-CORRECTION 롤백
-- laser_waiting → laser (laser_room NULL), checklist 복구 불가 (consult_waiting 유지)

-- laser_waiting → laser (room 없이)
UPDATE check_ins
SET status = 'laser', laser_room = NULL
WHERE status = 'laser_waiting';

-- CHECK constraint 이전 버전으로 복구
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered', 'checklist', 'exam_waiting', 'examination',
    'consult_waiting', 'consultation', 'payment_waiting',
    'treatment_waiting', 'preconditioning', 'laser',
    'done', 'cancelled'
  ));

-- T-20260602-foot-CHECKIN-RECEIVING-SLOT 롤백
-- 접수중(receiving) 상태 제거 → CHECK constraint 이전 버전(v5, 14개) 복구.
--
-- 주의: receiving 상태 활성 레코드가 존재하면 consult_waiting으로 이동 후 constraint 제거
--       (셀프접수 후 미저장 단계 = 실질적으로 상담대기 흐름으로 합류).

BEGIN;

-- 1) receiving → consult_waiting (활성 레코드 무손실 이동)
UPDATE check_ins
SET status = 'consult_waiting'
WHERE status = 'receiving';

-- 2) CHECK constraint 이전 버전으로 복구 (receiving 제외 14개 — 20260506000030 기준)
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',
    'checklist',
    'consult_waiting',
    'consultation',
    'exam_waiting',
    'examination',
    'treatment_waiting',
    'preconditioning',
    'laser_waiting',
    'healer_waiting',
    'laser',
    'payment_waiting',
    'done',
    'cancelled'
  ));

-- 3) 컬럼 코멘트 이전 버전으로 복구
COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (v5 2026-05-06): 신규 14단계. checklist = 태블릿 사전 체크리스트 작성 중. registered → checklist → exam_waiting (신규 초진 동선).';

COMMIT;

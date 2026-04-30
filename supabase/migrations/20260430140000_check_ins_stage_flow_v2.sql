-- T-20260430-foot-STAGE-FLOW-CORRECTION
-- 풋센터 스테이지 흐름 표준 정정 v2 (4/30 대표 확정)
--
-- 신규 11단계: registered → consult_waiting → consultation
--               → exam_waiting → examination
--               → treatment_waiting → preconditioning
--               → laser_waiting → laser
--               → payment_waiting → done
--
-- 재진 6단계:  treatment_waiting → preconditioning
--               → laser_waiting → laser
--               → payment_waiting → done
--
-- 변경사항:
--   - laser_waiting 신규 추가 (레이저실 대기 전 전용 상태)
--   - checklist 제거 (태블릿 외부 이전)
--   - payment_waiting 의미 변경: 상담 후 결제 → 레이저 후 수납
--
-- 리스크: DB 스키마 변경 (CHECK constraint 교체 + 데이터 매핑)

-- 1) 기존 CHECK constraint 제거
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;

-- 2) 신규 CHECK constraint 추가 (12개 status)
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',          -- 예약/접수
    'consult_waiting',     -- 상담대기
    'consultation',        -- 상담 중
    'exam_waiting',        -- 진료대기 (원장 진료 대기)
    'examination',         -- 원장실 (진료 중)
    'treatment_waiting',   -- 관리대기
    'preconditioning',     -- 관리 (사전처치/프리컨디셔닝)
    'laser_waiting',       -- 레이저대기 (NEW — 레이저실 입실 전 대기)
    'laser',               -- 레이저 (레이저실 시술 중)
    'payment_waiting',     -- 수납대기 (시술 후 수납, 의미 변경)
    'done',                -- 완료
    'cancelled'            -- 취소
  ));

-- 3) 기존 'checklist' 상태 → 'consult_waiting' 매핑
UPDATE check_ins
SET status = 'consult_waiting'
WHERE status = 'checklist';

-- 4) 기존 'laser' + laser_room IS NULL 상태 → 'laser_waiting' 매핑
--    (레이저실 배정 전 = 레이저대기로 이관)
UPDATE check_ins
SET status = 'laser_waiting'
WHERE status = 'laser' AND laser_room IS NULL;

-- 5) 컬럼 코멘트 갱신
COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (4/30 표준 v2): 신규 11단계 / 재진 6단계. laser_waiting = 레이저실 입실 전 대기. payment_waiting = 시술 후 수납대기.';

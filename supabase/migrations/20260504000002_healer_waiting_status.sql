-- T-20260502-foot-HEALER-WAIT-SLOT
-- 힐러대기 상태 추가 — 레이저대기 옆 별도 대기 슬롯
--
-- 변경사항:
--   - check_ins.status CHECK constraint에 'healer_waiting' 추가
--   - 힐러대기: 힐러 시술 전 대기 구역 (대시보드 레이저대기 옆 세로 배치)
--   - 최대 인원 제한 없음 (치료대기/레이저대기 동일)

-- 1) 기존 CHECK constraint 제거
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;

-- 2) 신규 CHECK constraint 추가 (healer_waiting 포함 13개 status)
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',          -- 예약/접수
    'consult_waiting',     -- 상담대기
    'consultation',        -- 상담 중
    'exam_waiting',        -- 진료대기 (원장 진료 대기)
    'examination',         -- 원장실 (진료 중)
    'treatment_waiting',   -- 관리대기
    'preconditioning',     -- 관리 (사전처치/프리컨디셔닝)
    'laser_waiting',       -- 레이저대기 (레이저실 입실 전 대기)
    'healer_waiting',      -- 힐러대기 (힐러 시술 전 대기, T-20260502-foot-HEALER-WAIT-SLOT)
    'laser',               -- 레이저 (레이저실 시술 중)
    'payment_waiting',     -- 수납대기 (시술 후 수납)
    'done',                -- 완료
    'cancelled'            -- 취소
  ));

-- 3) 컬럼 코멘트 갱신
COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (v3 2026-05-04): 신규 12단계 / 재진 7단계. healer_waiting = 힐러 시술 전 대기. laser_waiting = 레이저실 입실 전 대기. payment_waiting = 시술 후 수납대기.';

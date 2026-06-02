-- T-20260602-foot-CHECKIN-RECEIVING-SLOT
-- 접수중(receiving) 상태 추가 — 셀프접수 후 발건강질문지 작성 중(미저장) 단계.
--
-- 배경:
--   신규(초진) 셀프접수 시 발건강질문지 QR 스캔 → 작성 중에는 [접수중] 슬롯에 표시,
--   설문 "저장"(fn_health_q_submit) 시 자동으로 consult_waiting(상담대기)로 전이.
--   → 신규 status 'receiving' 필요. check_ins.status CHECK constraint 갱신.
--
-- 정책: Lovable 신규 상태값 추가 시 CHECK constraint 동시 갱신 (FE/DB 정합 필수).
-- 선례: 20260504000002_healer_waiting_status.sql (동일 DROP/ADD 패턴).
-- Rollback: 20260602240000_check_ins_receiving_status.rollback.sql
-- 운영 적용: supervisor 게이트.

BEGIN;

-- 1) 기존 CHECK constraint 제거
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_status_check;

-- 2) 신규 CHECK constraint 추가 ('receiving' 포함 15개 status)
ALTER TABLE check_ins ADD CONSTRAINT check_ins_status_check
  CHECK (status IN (
    'registered',          -- 예약/접수
    'receiving',           -- 접수중 (셀프접수 후 발건강질문지 작성 중, 미저장) ← 신규
    'checklist',           -- 사전 체크리스트 작성 중 (태블릿, deprecated)
    'consult_waiting',     -- 상담대기
    'consultation',        -- 상담 중
    'exam_waiting',        -- 진료대기 (원장 진료 대기)
    'examination',         -- 원장실 (진료 중)
    'treatment_waiting',   -- 관리대기
    'preconditioning',     -- 관리 (사전처치/프리컨디셔닝)
    'laser_waiting',       -- 레이저대기 (레이저실 입실 전 대기)
    'healer_waiting',      -- 힐러대기 (힐러 시술 전 대기)
    'laser',               -- 레이저 (레이저실 시술 중)
    'payment_waiting',     -- 수납대기 (시술 후 수납)
    'done',                -- 완료
    'cancelled'            -- 취소
  ));

-- 3) 컬럼 코멘트 갱신
COMMENT ON COLUMN check_ins.status IS
  '체크인 단계 (v6 2026-06-02): receiving = 셀프접수 후 발건강질문지 작성 중. 설문 저장 시 consult_waiting 전이. T-20260602-foot-CHECKIN-RECEIVING-SLOT.';

COMMIT;

-- T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3 분기 / AC-5 DB 확장
-- daily_room_status.carry_over: room_type별 carry-over 정책 지원
--
-- 정책:
--   carry_over = false (default): 상담실/치료실 — 당일 한정, 날짜 변경 시 자동 복귀
--   carry_over = true:            레이저실/장비방 — 수동 활성화 전까지 비활성 유지
--
-- Rollback: 20260524020000_daily_room_status_carry_over.down.sql
-- Ticket:   T-20260523-foot-ROOM-DISABLE-TOGGLE (AC-3, AC-5)

BEGIN;

-- ============================================================
-- 1. carry_over 컬럼 추가
-- ============================================================
ALTER TABLE daily_room_status
  ADD COLUMN IF NOT EXISTS carry_over BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN daily_room_status.carry_over IS
  'T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3:
   false (default) = 당일 한정 (상담실/치료실 — daily reset).
   true = 수동 활성화 전까지 비활성 유지 (레이저실/장비방 — carry-over).';

-- ============================================================
-- 2. 인덱스: carry-over 조회 최적화
--    fetchInactiveRooms 에서 carry_over=true 레코드 전체 스캔 방지
-- ============================================================
CREATE INDEX IF NOT EXISTS daily_room_status_carry_over_idx
  ON daily_room_status (clinic_id, carry_over, is_active)
  WHERE carry_over = true;

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인용)
-- ============================================================
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'daily_room_status'
--    AND column_name = 'carry_over';

-- T-20260420-foot-044
-- reservation_logs.action 값 표준화 (CHECK constraint)
--
-- 배경:
--   reservation_logs 테이블은 20260421000003에서 이미 생성됨 (action TEXT, old_data/new_data JSONB)
--   본 마이그레이션은 action 값 화이트리스트를 강제 + 향후 추가될 액션 명시
--
-- 허용 액션:
--   create          — 신규 예약 생성
--   update          — 예약 정보 수정 (이름/시간 외 필드)
--   reschedule      — 드래그 또는 수정으로 날짜/시간 변경
--   cancel          — 예약 취소
--   restore         — 취소된 예약 복원 (status: cancelled → confirmed)
--   status_change   — 그 외 상태 변경 (noshow, checked_in 등)
--   checkin_convert — 예약을 체크인으로 전환

-- 기존에 일치하지 않는 값이 있다면 표준화
UPDATE reservation_logs SET action = 'reschedule' WHERE action IN ('moved', 'rescheduled');
UPDATE reservation_logs SET action = 'cancel' WHERE action IN ('cancelled', 'canceled');
UPDATE reservation_logs SET action = 'create' WHERE action IN ('created', 'insert', 'inserted');
UPDATE reservation_logs SET action = 'update' WHERE action IN ('updated', 'modified');
UPDATE reservation_logs SET action = 'restore' WHERE action IN ('restored');

-- 외계값이 남아있는지 확인용 (실행 시 0건 기대)
-- SELECT DISTINCT action FROM reservation_logs WHERE action NOT IN ('create','update','reschedule','cancel','restore','status_change','checkin_convert');

ALTER TABLE reservation_logs DROP CONSTRAINT IF EXISTS reservation_logs_action_check;
ALTER TABLE reservation_logs
  ADD CONSTRAINT reservation_logs_action_check
  CHECK (action IN ('create','update','reschedule','cancel','restore','status_change','checkin_convert'));

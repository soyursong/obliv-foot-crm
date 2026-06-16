-- 롤백 — T-20260616-foot-LASER-TIMER-SETTING-CONNECT
-- timer_records.duration_minutes CHECK 를 기존 (IN 5,15,20) 으로 복원.
-- 주의: 복원 전 5/15/20 이외 값이 존재하면 ADD CONSTRAINT 가 실패한다.
--       (필요 시 해당 행 정리 후 재시도)

ALTER TABLE public.timer_records
  DROP CONSTRAINT IF EXISTS timer_records_duration_minutes_check;

ALTER TABLE public.timer_records
  ADD CONSTRAINT timer_records_duration_minutes_check
  CHECK (duration_minutes IN (5, 15, 20));

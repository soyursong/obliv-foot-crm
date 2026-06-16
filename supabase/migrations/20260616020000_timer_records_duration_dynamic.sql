-- T-20260616-foot-LASER-TIMER-SETTING-CONNECT
-- 비가열 레이저 타이머 시작 버튼을 clinics.laser_time_units 설정값으로 동적 생성하면서
-- timer_records.duration_minutes 의 하드코딩 CHECK (IN 5,15,20) 가 비-기본값(예: 10,30) 삽입을
-- 거부해 타이머가 시작되지 않는 숨은 결합을 해소한다.
--
-- 변경: CHECK (duration_minutes IN (5,15,20)) → CHECK (duration_minutes BETWEEN 1 AND 180)
--       (클리닉 설정 화면 ClinicSettingsTab.addCustom 의 1~180 입력 검증 범위와 일치)
--
-- 비파괴: 기존 행은 모두 5/15/20 (신규 범위 1~180 의 부분집합) → 데이터 손실/위반 없음.
-- 운영 영향: 없음 (제약 완화만, 테이블/컬럼/인덱스/RLS 무변경).

ALTER TABLE public.timer_records
  DROP CONSTRAINT IF EXISTS timer_records_duration_minutes_check;

ALTER TABLE public.timer_records
  ADD CONSTRAINT timer_records_duration_minutes_check
  CHECK (duration_minutes BETWEEN 1 AND 180);

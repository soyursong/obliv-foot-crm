-- T-20260507-foot-RESERVE-TIME
-- 목적: 예약 마지막 시간 변경 — 평일 20시, 토요일 18시
-- 요청: 김주연 (2026-05-08)
-- 롤백: UPDATE clinics SET close_time = '22:00', weekend_close_time = '19:00' WHERE slug = 'jongno-foot';
--        UPDATE clinic_schedules SET close_time = '22:00' WHERE day_of_week IN (1,2,3,4,5) AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');
--        UPDATE clinic_schedules SET close_time = '19:00' WHERE day_of_week = 6 AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');

-- generateSlots가 m < endMin 조건이므로 +30분 설정
-- 마지막 슬롯 20:00 → close_time '20:30'
-- 마지막 슬롯 18:00 → weekend_close_time '18:30'

UPDATE clinics
SET
  close_time = '20:30',
  weekend_close_time = '18:30'
WHERE slug = 'jongno-foot';

UPDATE clinic_schedules
SET close_time = '20:30'
WHERE day_of_week IN (1,2,3,4,5)
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');

UPDATE clinic_schedules
SET close_time = '18:30'
WHERE day_of_week = 6
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');

-- ============================================================
-- Seed Data — 오블리브 풋센터 종로
-- ============================================================

-- 1. Clinic
INSERT INTO clinics (name, slug, address, open_time, close_time, weekend_close_time, slot_interval,
  consultation_rooms, treatment_rooms, laser_rooms, exam_rooms)
VALUES (
  '오블리브 풋센터 종로', 'jongno-foot', '서울 종구 청계천로 93 5층',
  '10:00', '22:00', '19:00', 30, 5, 9, 12, 1
);

-- 2. Weekly schedule (Mon-Sat open, Sun closed)
INSERT INTO clinic_schedules (clinic_id, day_of_week, open_time, close_time, is_closed)
SELECT c.id, d.dow,
  CASE WHEN d.dow = 6 THEN '10:00'::time ELSE '10:00'::time END,
  CASE WHEN d.dow = 6 THEN '19:00'::time ELSE '22:00'::time END,
  CASE WHEN d.dow = 0 THEN true ELSE false END
FROM clinics c, (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(dow)
WHERE c.slug = 'jongno-foot';

-- 3. Services
INSERT INTO services (clinic_id, name, category, price, duration_min, vat_type, service_type, sort_order)
SELECT c.id, s.name, s.category, s.price, s.duration, s.vat, s.stype, s.sorder
FROM clinics c,
(VALUES
  ('힐러',              'heated_laser',   350000, 10, 'none',      'single', 1),
  ('큰발톱 추가',       'heated_laser',    50000, 0,  'none',      'addon',  2),
  ('작은발톱 추가',      'heated_laser',    30000, 0,  'none',      'addon',  3),
  ('오니코',            'unheated_laser', 260000, 20, 'none',      'single', 4),
  ('아톰',              'unheated_laser', 280000, 20, 'none',      'single', 5),
  ('AF',               'unheated_laser', 300000, 20, 'none',      'single', 6),
  ('포돌로게',          'nail',           300000, 30, 'none',      'single', 7),
  ('발톱재생 수액',      'iv',            110000, 0,  'exclusive', 'single', 8),
  ('항염순환 수액',      'iv',            110000, 0,  'exclusive', 'single', 9),
  ('글로우부스팅 수액',   'iv',             90000, 0,  'exclusive', 'single', 10),
  ('성장호르몬 수액',    'iv',            200000, 0,  'exclusive', 'single', 11),
  ('태반 수액',         'iv',             90000, 0,  'exclusive', 'single', 12),
  ('사이모신알파 수액',   'iv',            150000, 0,  'exclusive', 'single', 13),
  ('비타민D 수액',       'iv',             50000, 0,  'exclusive', 'single', 14),
  ('비타민C 메가도즈',    'iv',             90000, 0,  'exclusive', 'single', 15),
  ('6000샷 업그레이드',   'option',         50000, 0,  'none',      'addon',  16),
  ('AF 업그레이드',      'option',         40000, 0,  'none',      'addon',  17),
  ('프리컨디셔닝',       'treatment',          0, 20, 'none',      'package_component', 18)
) AS s(name, category, price, duration, vat, stype, sorder)
WHERE c.slug = 'jongno-foot';

-- 4. Rooms
INSERT INTO rooms (clinic_id, name, room_type, sort_order)
SELECT c.id, r.name, r.rtype, r.sorder
FROM clinics c, (
  SELECT '치료실' || n AS name, 'treatment' AS rtype, n AS sorder FROM generate_series(1,9) n
  UNION ALL
  SELECT '레이저실' || n, 'laser', 10+n FROM generate_series(1,12) n
  UNION ALL
  SELECT '상담실' || n, 'consultation', 30+n FROM generate_series(1,5) n
  UNION ALL
  SELECT '원장실', 'examination', 40
) r
WHERE c.slug = 'jongno-foot';

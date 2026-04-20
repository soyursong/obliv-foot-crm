-- 르샤인 문제성발톱 클리닉 수가표 (녹취록 04-19) 반영
-- 레이저 시술 정찰가 + 비가열 레이저 세부 장비별 엔트리
-- 수액 = 비급여 vat_type 'exclusive' (기존 정합)
-- price 단위: 원
-- duration 단위: 분 (가열 8~10분 / 비가열 20분 / 3~4시간은 세션 총 시간 아닌 시술 단위)

-- Foot-center 레이저 단건 시술
INSERT INTO services (clinic_id, name, category, price, duration_min, vat_type, service_type, sort_order)
SELECT c.id, s.name, s.cat, s.price, s.dur, s.vat, s.stype, s.sorder
FROM clinics c, (VALUES
  ('가열 레이저 (듀얼렉스+듀오)',      'laser',       340000, 10, 'none',      'single',            20),
  ('가열+비가열 콤보 레이저',          'laser',       420000, 30, 'none',      'single',            21),
  ('비가열 레이저 - 오니코',           'laser',       240000, 20, 'none',      'single',            22),
  ('비가열 레이저 - 클라리',           'laser',       240000, 20, 'none',      'single',            23),
  ('비가열 레이저 - 루눌라',           'laser',       240000, 20, 'none',      'single',            24),
  ('수액 레이저',                     'laser',       200000, 20, 'none',      'single',            25),
  ('AF 레이저',                       'laser',       200000, 20, 'none',      'single',            26),
  ('풀 코 패키지',                    'treatment',   300000, 60, 'none',      'single',            27),
  ('HC경 레이저',                     'laser',       200000, 15, 'none',      'single',            28)
) AS s(name, cat, price, dur, vat, stype, sorder)
WHERE c.slug = 'jongno-foot'
ON CONFLICT DO NOTHING;

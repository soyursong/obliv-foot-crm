-- T-20260510-foot-SVCMENU-REVAMP
-- services.category_label 컬럼 추가 + 48개 항목 seed
-- Rollback: 20260510000040_services_category_label_seed.down.sql

-- 1. category_label 컬럼 추가
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS category_label TEXT;

COMMENT ON COLUMN public.services.category_label IS '항목분류 (기본/검사/상병/풋케어/수액/풋화장품) — T-20260510-foot-SVCMENU-REVAMP';

-- 2. 48개 항목 seed (ON CONFLICT DO UPDATE 패턴 — 상품코드 기준)
-- clinic_id는 obliv-foot 클리닉. '오블리브 풋센터' 슬러그로 조회.
DO $$
DECLARE
  v_clinic_id UUID;
BEGIN
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug LIKE '%foot%' LIMIT 1;
  IF v_clinic_id IS NULL THEN
    RAISE NOTICE 'foot clinic not found, skipping seed';
    RETURN;
  END IF;

  -- 기본 (14건)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'AA154',   '초진진찰료',                   '기본', 18840, 'none', 'single', true,  10, '기본'),
    (v_clinic_id, 'AA155',   '재진진찰료',                   '기본', 13740, 'none', 'single', true,  20, '기본'),
    (v_clinic_id, 'AA157',   '의사전화상담',                 '기본', 13740, 'none', 'single', true,  30, '기본'),
    (v_clinic_id, 'ADD108',  '일반조제료',                   '기본',  3820, 'none', 'single', true,  40, '기본'),
    (v_clinic_id, 'ADD109',  '의약품관리료',                 '기본',   500, 'none', 'single', true,  50, '기본'),
    (v_clinic_id, 'C2100001','재진진찰료(영상판독)',         '기본', 13740, 'none', 'single', true,  60, '기본'),
    (v_clinic_id, 'C5900001','의무기록사본',                 '기본',  1000, 'none', 'single', true,  70, '기본'),
    (v_clinic_id, 'C5900002','진단서',                       '기본', 20000, 'none', 'single', true,  80, '기본'),
    (v_clinic_id, 'C5900003','소견서',                       '기본', 10000, 'none', 'single', true,  90, '기본'),
    (v_clinic_id, 'C5900004','진료확인서',                   '기본',  3000, 'none', 'single', true, 100, '기본'),
    (v_clinic_id, 'C5900005','보험용진단서',                 '기본', 30000, 'none', 'single', true, 110, '기본'),
    (v_clinic_id, 'C5900006','상해진단서',                   '기본', 60000, 'none', 'single', true, 120, '기본'),
    (v_clinic_id, 'C5900007','사망진단서',                   '기본', 60000, 'none', 'single', true, 130, '기본'),
    (v_clinic_id, 'C5900008','후유장해진단서',               '기본', 60000, 'none', 'single', true, 140, '기본')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    vat_type     = EXCLUDED.vat_type,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

  -- 검사 (2건)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'D2501001','피검사',                       '검사', 20000, 'none', 'single', true, 210, '검사'),
    (v_clinic_id, 'D2502001','KOH도말검사',                  '검사', 14390, 'none', 'single', true, 220, '검사')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

  -- 상병 (5건 — 진단코드, 단가 0)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'B351',    '손발톱백선',                   '상병',     0, 'none', 'single', true, 310, '상병'),
    (v_clinic_id, 'B353',    '발백선',                       '상병',     0, 'none', 'single', true, 320, '상병'),
    (v_clinic_id, 'L600',    '내성발톱(감입발톱)',           '상병',     0, 'none', 'single', true, 330, '상병'),
    (v_clinic_id, 'L840',    '굳은살',                       '상병',     0, 'none', 'single', true, 340, '상병'),
    (v_clinic_id, 'L720',    '표피낭종(티눈)',               '상병',     0, 'none', 'single', true, 350, '상병')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

  -- 풋케어 (14건)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'FC001',   '체험',                         '풋케어',  55000, 'inclusive', 'single', true, 410, '풋케어'),
    (v_clinic_id, 'FC002',   '포돌로게',                     '풋케어', 130000, 'inclusive', 'single', true, 420, '풋케어'),
    (v_clinic_id, 'FC003',   '힐러 가열성레이저',            '풋케어', 150000, 'inclusive', 'single', true, 430, '풋케어'),
    (v_clinic_id, 'FC004',   '힐러 가열성레이저+포돌로게',   '풋케어', 250000, 'inclusive', 'single', true, 440, '풋케어'),
    (v_clinic_id, 'FC005',   '힐러 가열성레이저+포돌로게+수액', '풋케어', 350000, 'inclusive', 'single', true, 450, '풋케어'),
    (v_clinic_id, 'FC006',   '내성발톱 처치(단측)',          '풋케어', 100000, 'inclusive', 'single', true, 460, '풋케어'),
    (v_clinic_id, 'FC007',   '내성발톱 처치(양측)',          '풋케어', 170000, 'inclusive', 'single', true, 470, '풋케어'),
    (v_clinic_id, 'FC008',   '굳은살/티눈 제거',             '풋케어',  80000, 'inclusive', 'single', true, 480, '풋케어'),
    (v_clinic_id, 'FC009',   '발각질제거 기본',              '풋케어',  60000, 'inclusive', 'single', true, 490, '풋케어'),
    (v_clinic_id, 'FC010',   '발각질제거 프리미엄',          '풋케어',  90000, 'inclusive', 'single', true, 500, '풋케어'),
    (v_clinic_id, 'FC011',   '프리컨디셔닝',                 '풋케어',  30000, 'inclusive', 'single', true, 510, '풋케어'),
    (v_clinic_id, 'FC012',   '발냄새케어',                   '풋케어',  50000, 'inclusive', 'single', true, 520, '풋케어'),
    (v_clinic_id, 'FC013',   '당뇨발케어',                   '풋케어', 120000, 'inclusive', 'single', true, 530, '풋케어'),
    (v_clinic_id, 'FC014',   '발건강종합케어',               '풋케어', 200000, 'inclusive', 'single', true, 540, '풋케어')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

  -- 수액 (8건)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'IV001',   '재생수액',                     '수액', 120000, 'inclusive', 'single', true, 610, '수액'),
    (v_clinic_id, 'IV002',   '성장호르몬(소마트로핀)',       '수액', 200000, 'inclusive', 'single', true, 620, '수액'),
    (v_clinic_id, 'IV003',   '비타민C 고용량주사',           '수액',  80000, 'inclusive', 'single', true, 630, '수액'),
    (v_clinic_id, 'IV004',   '마늘주사(아릴진)',             '수액',  50000, 'inclusive', 'single', true, 640, '수액'),
    (v_clinic_id, 'IV005',   '백옥주사(글루타치온)',         '수액',  60000, 'inclusive', 'single', true, 650, '수액'),
    (v_clinic_id, 'IV006',   '신데렐라주사(알파리포산)',     '수액',  60000, 'inclusive', 'single', true, 660, '수액'),
    (v_clinic_id, 'IV007',   '태반주사(라이넥)',             '수액',  80000, 'inclusive', 'single', true, 670, '수액'),
    (v_clinic_id, 'IV008',   '면역수액(마이어스칵테일)',     '수액', 100000, 'inclusive', 'single', true, 680, '수액')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

  -- 풋화장품 (5건)
  INSERT INTO public.services (clinic_id, service_code, name, category_label, price, vat_type, service_type, active, sort_order, category)
  VALUES
    (v_clinic_id, 'CS001',   '풋샴푸(150ml)',                '풋화장품', 25000, 'inclusive', 'single', true, 710, '풋화장품'),
    (v_clinic_id, 'CS002',   '우레아크림(200ml)',            '풋화장품', 30000, 'inclusive', 'single', true, 720, '풋화장품'),
    (v_clinic_id, 'CS003',   '발냄새스프레이(100ml)',        '풋화장품', 18000, 'inclusive', 'single', true, 730, '풋화장품'),
    (v_clinic_id, 'CS004',   '발각질크림(100g)',             '풋화장품', 22000, 'inclusive', 'single', true, 740, '풋화장품'),
    (v_clinic_id, 'CS005',   '발보습세트(샴푸+크림)',        '풋화장품', 45000, 'inclusive', 'single', true, 750, '풋화장품')
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name         = EXCLUDED.name,
    category_label = EXCLUDED.category_label,
    price        = EXCLUDED.price,
    sort_order   = EXCLUDED.sort_order,
    active       = EXCLUDED.active;

END $$;

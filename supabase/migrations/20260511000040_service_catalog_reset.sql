BEGIN;

-- ============= ROLLBACK 방법 =============
-- down SQL: supabase/migrations/20260511000040_service_catalog_reset.down.sql
-- psql 또는 Supabase Dashboard SQL Editor에서 실행
-- 1. 새로 삽입된 66개 서비스 삭제 (service_code IN 목록)
-- 2. 참조 있는 3개 서비스 active=true 복원

-- ============= 참조 있는 3개 서비스 비활성화 (soft delete) =============
-- service_charges 테이블에서 참조 중이므로 hard delete 불가
UPDATE public.services SET active = false
WHERE id IN (
  'b98f6831-12a3-459b-b199-f543dd15cba1',  -- 진찰료 (초진), category=진료
  '62cb8022-7e19-423f-9d87-b5545a53c7cd',  -- KOH 균검사, category=검사
  '31f0bf2c-c339-4367-bce8-0e9c988b0c3d'   -- 일반 처방료, category=처방
);

-- ============= 참조 없는 기존 서비스 전체 삭제 =============
DELETE FROM public.services
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND id NOT IN (
    'b98f6831-12a3-459b-b199-f543dd15cba1',
    '62cb8022-7e19-423f-9d87-b5545a53c7cd',
    '31f0bf2c-c339-4367-bce8-0e9c988b0c3d'
  );

-- ============= 새 서비스 66개 INSERT =============
-- 소스: ~/file_inbox/20260511/170453_F0B3SLT1XTJ_자체개발 CRM 업데이트.xlsx
-- 카테고리: 기본(14), 검사(2), 상병(5), 풋케어(14), 수액(8), 풋 화장품(7), 처방약(16)
-- sort_order: 카테고리_index * 10 + 카테고리내_행번호
INSERT INTO public.services (clinic_id, name, category, category_label, price, service_code, vat_type, service_type, active, is_insurance_covered, sort_order)
VALUES
  -- [기본] 14개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '초진진찰료-의원', '기본', '기본', 18840, 'AA154', 'none', 'single', true, false, 11),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '재진진찰료-의원', '기본', '기본', 13370, 'AA254', 'none', 'single', true, false, 12),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '재진-물리치료,주사 등 시술받은 경우', '기본', '기본', 4690, 'AA222', 'none', 'single', true, false, 13),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '단순처치 [1일]', '기본', '기본', 7220, 'M0111', 'none', 'single', true, false, 14),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진단서', '기본', '기본', 10000, '진단서', 'none', 'single', true, false, 15),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료소견서', '기본', '기본', 10000, '진료소견서', 'none', 'single', true, false, 16),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료의뢰서', '기본', '기본', 0, '진료의뢰서', 'none', 'single', true, false, 17),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료확인서(코드,진단명 포함)', '기본', '기본', 10000, '진료확인서1', 'none', 'single', true, false, 18),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료확인서(코드,진단명 불포함)', '기본', '기본', 3000, '진료확인서2', 'none', 'single', true, false, 19),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '통원확인서', '기본', '기본', 3000, '통원확인서', 'none', 'single', true, false, 20),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진단서(영문)', '기본', '기본', 30000, '진단서(영문)', 'none', 'single', true, false, 21),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '소견서(영문)', '기본', '기본', 30000, '소견서(영문)', 'none', 'single', true, false, 22),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료기록사본(1-5매)', '기본', '기본', 1000, '진료기록사본1', 'none', 'single', true, false, 23),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료기록사본(6매 이상, 1매당 금액)', '기본', '기본', 100, '진료기록사본2', 'none', 'single', true, false, 24),
  -- [검사] 2개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '피검사', '검사', '검사', 50000, '피검사', 'none', 'single', true, false, 21),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '일반진균검사-KOH도말-조갑조직', '검사', '검사', 10540, 'D620300HZ', 'none', 'single', true, false, 22),
  -- [상병] 5개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '손발톱백선', '상병', '상병', 0, 'B351', 'none', 'single', true, false, 31),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '발백선', '상병', '상병', 0, 'B353', 'none', 'single', true, false, 32),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '내향성 손발톱', '상병', '상병', 0, 'L600', 'none', 'single', true, false, 33),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '상세불명의 위염', '상병', '상병', 0, 'K297', 'none', 'single', true, false, 34),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '체부백선', '상병', '상병', 0, 'B354', 'none', 'single', true, false, 35),
  -- [풋케어] 14개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '1회 만원 체험(PC5분+NL5분)', '풋케어', '풋케어', 10000, '체험', 'none', 'single', true, false, 41),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '패디젤제거', '풋케어', '풋케어', 10000, '젤제거', 'none', 'single', true, false, 42),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '크랙힐 (발바닥각질제거)', '풋케어', '풋케어', 0, 'CH', 'none', 'single', true, false, 43),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '프리컨디셔닝', '풋케어', '풋케어', 0, 'PC', 'none', 'single', true, false, 44),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '애프터컨디셔닝', '풋케어', '풋케어', 0, 'AC', 'none', 'single', true, false, 45),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '원인제거 (내성발톱)', '풋케어', '풋케어', 0, '원인제거', 'none', 'single', true, false, 46),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '포돌로게(내성발톱 치료의료기기)', '풋케어', '풋케어', 300000, 'BC1300MB08', 'none', 'single', true, false, 47),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '가열성 진균증 레이저 치료', '풋케어', '풋케어', 350000, 'SZ035-35', 'none', 'single', true, false, 48),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '비가열성 진균증 레이저 치료', '풋케어', '풋케어', 300000, 'SZ035-30', 'none', 'single', true, false, 49),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '비가열성 레이저 (통합)', '풋케어', '풋케어', 240000, 'NL', 'none', 'single', true, false, 50),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '오니코 비가열성 레이저', '풋케어', '풋케어', 260000, 'OL', 'none', 'single', true, false, 51),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '아톰 비가열성 레이저', '풋케어', '풋케어', 280000, 'TL', 'none', 'single', true, false, 52),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'AF 비가열성 레이저', '풋케어', '풋케어', 300000, 'FL', 'none', 'single', true, false, 53),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '힐러 가열성 레이저', '풋케어', '풋케어', 350000, 'HL', 'none', 'single', true, false, 54),
  -- [수액] 8개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '재생수액', '수액', '수액', 110000, '재생수액', 'none', 'single', true, false, 51),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '항염수액', '수액', '수액', 110000, '항염수액', 'none', 'single', true, false, 52),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '글로우수액', '수액', '수액', 90000, '글로우수액', 'none', 'single', true, false, 53),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '성장호르몬', '수액', '수액', 200000, '성장호르몬', 'none', 'single', true, false, 54),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '태반주사', '수액', '수액', 90000, '태반주사', 'none', 'single', true, false, 55),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '사이모신 알파주사', '수액', '수액', 150000, '사이모신 알파주사', 'none', 'single', true, false, 56),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '비타민D 주사', '수액', '수액', 50000, '비타민D 주사', 'none', 'single', true, false, 57),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '비타민C 주사', '수액', '수액', 90000, '비타민C 주사', 'none', 'single', true, false, 58),
  -- [풋 화장품] 7개
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '풋샴푸 (200ml)', '풋 화장품', '풋 화장품', 32000, 'DCS-1', 'none', 'single', true, false, 61),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '프룻 핸드 풋 크림 (125ml)', '풋 화장품', '풋 화장품', 53000, 'DCS-2', 'none', 'single', true, false, 62),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '우레아 10% 프로텍티브 크림 (125ml)', '풋 화장품', '풋 화장품', 52000, 'DCS-3', 'none', 'single', true, false, 63),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '안티 펑거스 포도 포르테 (드롭 / 30ml)', '풋 화장품', '풋 화장품', 50000, 'DCS-4', 'none', 'single', true, false, 64),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '안티 펑거스 포도 포르테 (스프레이 / 30ml)', '풋 화장품', '풋 화장품', 47000, 'DCS-5', 'none', 'single', true, false, 65),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '네일 폴드 오일 (7ml)', '풋 화장품', '풋 화장품', 47000, 'DCS-6', 'none', 'single', true, false, 66),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '리페어 핸드크림 (30ml)', '풋 화장품', '풋 화장품', 15000, 'DCS-7', 'none', 'single', true, false, 67),
  -- [처방약] 16개 (service_code = 정수형 품목코드 → 문자열 변환)
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '케이졸', '처방약', '처방약', 0, '698004570', 'none', 'single', true, false, 71),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '주블리아외용액 8mL(에피나코나졸)', '처방약', '처방약', 0, '642507551', 'none', 'single', true, false, 72),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '주블리아외용액 4ml(에피나코나졸)', '처방약', '처방약', 0, '642507391', 'none', 'single', true, false, 73),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '바르토벤외용액 8mL(에피나코나졸)', '처방약', '처방약', 0, '57001772', 'none', 'single', true, false, 74),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '바르토벤외용액 4mL(에피나코나졸)', '처방약', '처방약', 0, '57001771', 'none', 'single', true, false, 75),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '한미유리아크림200밀리그램(우레아)(4g/20g)', '처방약', '처방약', 0, '643503741', 'none', 'single', true, false, 76),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '한미유리아크림200밀리그램(우레아)(10g/50g)', '처방약', '처방약', 0, '643503743', 'none', 'single', true, false, 77),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '터미졸크림(테르비나핀염산염)(15g)', '처방약', '처방약', 0, '57000061', 'none', 'single', true, false, 78),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '에스로반연고(무피로신)(10g)', '처방약', '처방약', 0, '644100481', 'none', 'single', true, false, 79),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '하이트리크림(0.2g,0.2g/20g)', '처방약', '처방약', 0, '671701861', 'none', 'single', true, false, 80),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '베타베이트연고(클로베타솔프로피오네이트)(7.5mg/15g)', '처방약', '처방약', 0, '642800741', 'none', 'single', true, false, 81),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '삼아리도멕스크림(프레드니솔론발레로아세테이트)(60mg/20g)', '처방약', '처방약', 0, '645700564', 'none', 'single', true, false, 82),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '대웅푸루나졸정150밀리그람(플루코나졸)', '처방약', '처방약', 0, '641601050', 'none', 'single', true, false, 83),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '루마졸크림(플루트리마졸)_(0.3g/30g)', '처방약', '처방약', 0, '622802642', 'none', 'single', true, false, 84),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '플루코엠캡슐(플루코나졸)_(50mg/1캡슐)', '처방약', '처방약', 0, '622805210', 'none', 'single', true, false, 85),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '발무드겔(테르비나핀)_(0.2g/20g)', '처방약', '처방약', 0, '657301832', 'none', 'single', true, false, 86)
ON CONFLICT (clinic_id, name) DO UPDATE SET
  category       = EXCLUDED.category,
  category_label = EXCLUDED.category_label,
  price          = EXCLUDED.price,
  service_code   = EXCLUDED.service_code,
  vat_type       = EXCLUDED.vat_type,
  service_type   = EXCLUDED.service_type,
  active         = EXCLUDED.active,
  is_insurance_covered = EXCLUDED.is_insurance_covered,
  sort_order     = EXCLUDED.sort_order;

COMMIT;

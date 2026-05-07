-- T-20260507-foot-SERVICE-CATALOG-SEED
-- 목적: services.service_code 컬럼 추가 + 풋센터 판매상품 28개 공식 시드
-- 롤백: ALTER TABLE services DROP CONSTRAINT IF EXISTS uq_services_clinic_name;
--        ALTER TABLE services DROP COLUMN IF EXISTS service_code;
--        DELETE FROM services WHERE service_code IS NOT NULL AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');

-- ── 1. service_code 컬럼 추가 ──
ALTER TABLE services ADD COLUMN IF NOT EXISTS service_code TEXT;
CREATE INDEX IF NOT EXISTS idx_services_service_code ON services(service_code);

-- ↓ UNIQUE constraint 추가 전 중복 행 제거
DELETE FROM services WHERE id IN (
  SELECT s1.id FROM services s1
  INNER JOIN services s2 ON s1.clinic_id = s2.clinic_id AND s1.name = s2.name AND s1.id > s2.id
);
ALTER TABLE services ADD CONSTRAINT uq_services_clinic_name UNIQUE(clinic_id, name);

-- ── 2. 풋센터 판매상품 28개 시드 (jongno-foot) ──
-- On conflict: 같은 clinic_id + name이면 service_code + price 업데이트
DO $$
DECLARE
  v_clinic_id UUID;
BEGIN
  SELECT id INTO v_clinic_id FROM clinics WHERE slug = 'jongno-foot' LIMIT 1;
  IF v_clinic_id IS NULL THEN
    RAISE WARNING 'Clinic jongno-foot not found — seed skipped';
    RETURN;
  END IF;

  -- 대분류: 레이저 (가열)
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, active, sort_order)
  VALUES
    (v_clinic_id, 'LZ-HOT-01', '가열 레이저 (1회)', '레이저', 80000, 30, 'none', 'single', false, true, 10),
    (v_clinic_id, 'LZ-HOT-05', '가열 레이저 패키지 5회', '레이저', 350000, 30, 'none', 'package_component', false, true, 11),
    (v_clinic_id, 'LZ-HOT-10', '가열 레이저 패키지 10회', '레이저', 650000, 30, 'none', 'package_component', false, true, 12),
    (v_clinic_id, 'LZ-HOT-15', '가열 레이저 패키지 15회', '레이저', 900000, 30, 'none', 'package_component', false, true, 13),
    (v_clinic_id, 'LZ-HOT-20', '가열 레이저 패키지 20회', '레이저', 1100000, 30, 'none', 'package_component', false, true, 14),
    -- 가열 업그레이드 (6000샷)
    (v_clinic_id, 'LZ-HOT-UPG', '가열 6000샷 업그레이드', '레이저', 50000, 0, 'none', 'addon', false, true, 15)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        sort_order = EXCLUDED.sort_order;

  -- 대분류: 레이저 (비가열)
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, active, sort_order)
  VALUES
    (v_clinic_id, 'LZ-COOL-01', '비가열 레이저 (1회)', '레이저', 70000, 30, 'none', 'single', false, true, 20),
    (v_clinic_id, 'LZ-COOL-05', '비가열 레이저 패키지 5회', '레이저', 300000, 30, 'none', 'package_component', false, true, 21),
    (v_clinic_id, 'LZ-COOL-10', '비가열 레이저 패키지 10회', '레이저', 550000, 30, 'none', 'package_component', false, true, 22),
    (v_clinic_id, 'LZ-COOL-15', '비가열 레이저 패키지 15회', '레이저', 780000, 30, 'none', 'package_component', false, true, 23),
    (v_clinic_id, 'LZ-COOL-20', '비가열 레이저 패키지 20회', '레이저', 980000, 30, 'none', 'package_component', false, true, 24),
    -- AF 업그레이드
    (v_clinic_id, 'LZ-COOL-AF', '비가열 AF 업그레이드', '레이저', 40000, 0, 'none', 'addon', false, true, 25)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        sort_order = EXCLUDED.sort_order;

  -- 대분류: 풋케어 (포돌로게 / 사전처치)
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, active, sort_order)
  VALUES
    (v_clinic_id, 'FC-PDL-01', '포돌로게 시술 (1회)', '풋케어', 50000, 40, 'none', 'single', false, true, 30),
    (v_clinic_id, 'FC-PDL-05', '포돌로게 패키지 5회', '풋케어', 220000, 40, 'none', 'package_component', false, true, 31),
    (v_clinic_id, 'FC-PRE-01', '프리컨디셔닝 (1회)', '사전처치', 30000, 20, 'none', 'single', false, true, 35),
    (v_clinic_id, 'FC-PRE-05', '프리컨디셔닝 패키지 5회', '사전처치', 130000, 20, 'none', 'package_component', false, true, 36)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        sort_order = EXCLUDED.sort_order;

  -- 대분류: 수액
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, active, sort_order)
  VALUES
    (v_clinic_id, 'IV-STD-01', '수액 (표준)', '수액', 50000, 60, 'none', 'single', false, true, 40),
    (v_clinic_id, 'IV-VIT-01', '수액 (비타민C)', '수액', 60000, 60, 'none', 'single', false, true, 41),
    (v_clinic_id, 'IV-GFT-01', '수액 (글루타치온)', '수액', 80000, 60, 'none', 'single', false, true, 42)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        sort_order = EXCLUDED.sort_order;

  -- 대분류: 상담 / 검사 (건보 급여)
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, hira_code, active, sort_order)
  VALUES
    (v_clinic_id, 'DX-INIT-01', '초진 진찰료', '상담', 14000, 15, 'none', 'single', true, 'AA157', true, 50),
    (v_clinic_id, 'DX-RTRN-01', '재진 진찰료', '상담', 9000, 10, 'none', 'single', true, 'AA157', true, 51),
    (v_clinic_id, 'DX-KOH-01', 'KOH 균검사', '검사', 15000, 20, 'none', 'single', true, 'D7020', true, 52),
    (v_clinic_id, 'DX-CONS-01', '상담료', '상담', 0, 15, 'none', 'single', false, null, true, 53)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        is_insurance_covered = EXCLUDED.is_insurance_covered,
        hira_code = EXCLUDED.hira_code,
        sort_order = EXCLUDED.sort_order;

  -- 대분류: 풋화장품 / 기타
  INSERT INTO services (clinic_id, service_code, name, category, price, duration_min, vat_type, service_type, is_insurance_covered, active, sort_order)
  VALUES
    (v_clinic_id, 'PROD-CRM-01', '풋케어 크림 (100ml)', '풋화장품', 35000, 0, 'inclusive', 'single', false, true, 60),
    (v_clinic_id, 'PROD-SPR-01', '발 항균 스프레이', '풋화장품', 20000, 0, 'inclusive', 'single', false, true, 61),
    (v_clinic_id, 'PROD-SOC-01', '의료용 양말 (1켤레)', '풋화장품', 15000, 0, 'inclusive', 'single', false, true, 62)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET service_code = EXCLUDED.service_code,
        price = EXCLUDED.price,
        sort_order = EXCLUDED.sort_order;

  RAISE NOTICE 'jongno-foot service seed 완료 (clinic_id: %)', v_clinic_id;
END $$;

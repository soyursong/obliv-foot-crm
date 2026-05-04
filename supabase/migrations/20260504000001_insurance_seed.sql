-- T-20260504-foot-INSURANCE-COPAYMENT — 시드 데이터
-- 풋센터 기본 급여/비급여 항목 (HIRA 매핑 + 진단서 등)
-- 표준처방코드.xlsx 전체 매핑은 추후 수동 보완 (xlsx 파서 도입 시)
-- Created: 2026-05-04 (dev-foot)

-- ============================================================
-- 1) jongno-foot 클리닉의 환산지수 확인 (default 89.4 / 2024)
-- ============================================================
UPDATE clinics
SET hira_unit_value = COALESCE(hira_unit_value, 89.4),
    hira_unit_value_year = COALESCE(hira_unit_value_year, 2024)
WHERE slug = 'jongno-foot';

-- ============================================================
-- 2) 풋센터 기본 급여 진료 항목 시드
--   - 진찰료 초진 (AA154, 153.36점)
--   - 진찰료 재진 (AA254, 109.50점)
--   - KOH 균검사 (D6591 추정 — 추후 표준처방코드.xlsx 매핑 시 보완)
--   - 진단서 발급 (비급여 — document)
--   - 일반 처방료 (AA700 가정 — 추후 보완)
-- ============================================================

-- 진찰료 초진
INSERT INTO services (
  clinic_id, name, category, price, duration_min, vat_type, service_type, active, sort_order,
  is_insurance_covered, hira_code, hira_score, hira_category
)
SELECT c.id, '진찰료 (초진)', '진료', 0, 5, 'none', 'single', true, 1000,
       true, 'AA154', 153.36, 'consultation'
FROM clinics c
WHERE c.slug = 'jongno-foot'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.clinic_id = c.id AND s.hira_code = 'AA154');

-- 진찰료 재진
INSERT INTO services (
  clinic_id, name, category, price, duration_min, vat_type, service_type, active, sort_order,
  is_insurance_covered, hira_code, hira_score, hira_category
)
SELECT c.id, '진찰료 (재진)', '진료', 0, 5, 'none', 'single', true, 1001,
       true, 'AA254', 109.50, 'consultation'
FROM clinics c
WHERE c.slug = 'jongno-foot'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.clinic_id = c.id AND s.hira_code = 'AA254');

-- KOH 균검사 (코드 추후 보완 — 임시 'D6591' / 정확 코드는 표준처방코드.xlsx 기반 수동 업데이트)
INSERT INTO services (
  clinic_id, name, category, price, duration_min, vat_type, service_type, active, sort_order,
  is_insurance_covered, hira_code, hira_score, hira_category
)
SELECT c.id, 'KOH 균검사', '검사', 0, 10, 'none', 'single', true, 1010,
       true, 'D6591', 28.50, 'examination'
FROM clinics c
WHERE c.slug = 'jongno-foot'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.clinic_id = c.id AND s.hira_code = 'D6591');

-- 일반 처방료 (코드 추후 보완 — 임시 'AA700')
INSERT INTO services (
  clinic_id, name, category, price, duration_min, vat_type, service_type, active, sort_order,
  is_insurance_covered, hira_code, hira_score, hira_category
)
SELECT c.id, '일반 처방료', '처방', 0, 5, 'none', 'single', true, 1020,
       true, 'AA700', 10.00, 'prescription'
FROM clinics c
WHERE c.slug = 'jongno-foot'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.clinic_id = c.id AND s.hira_code = 'AA700');

-- 진단서 발급 — 비급여 (document 카테고리지만 is_insurance_covered = false)
INSERT INTO services (
  clinic_id, name, category, price, duration_min, vat_type, service_type, active, sort_order,
  is_insurance_covered, hira_category
)
SELECT c.id, '진단서 발급 (일반)', '서류', 20000, 5, 'none', 'single', true, 1030,
       false, 'document'
FROM clinics c
WHERE c.slug = 'jongno-foot'
  AND NOT EXISTS (
    SELECT 1 FROM services s
    WHERE s.clinic_id = c.id AND s.name = '진단서 발급 (일반)'
  );

-- ============================================================
-- 3) TODO: 표준처방코드.xlsx 전체 매핑은 별도 작업
--   - 위치: 2_Areas/204_오블리브_종로점오픈/forms_consent/표준처방코드.xlsx
--   - 파싱 후 services.hira_code/hira_score/hira_category 일괄 업데이트
--   - 신규 항목은 INSERT, 기존 항목은 UPDATE
-- ============================================================

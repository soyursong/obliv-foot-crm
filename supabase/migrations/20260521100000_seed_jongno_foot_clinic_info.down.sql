-- Rollback: 20260521100000_seed_jongno_foot_clinic_info.sql
-- 병원정보를 이전 값(NULL)으로 복원
-- 주의: 이전에 phone/business_no가 있었다면 별도 복원 필요
UPDATE clinics
SET
  name         = '오블리브 풋센터 종로',
  phone        = NULL,
  fax          = NULL,
  business_no  = NULL
WHERE slug = 'jongno-foot';

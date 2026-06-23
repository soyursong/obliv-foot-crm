-- T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND
-- 병원(기관) 이메일 컬럼 추가 — 원장정보>병원정보 폼 입력 + 처방전 의료기관 블록 E-mail 주소 자동 바인딩
-- 환자 이메일(customers.customer_email)과 별개의 기관 이메일.
-- 안전: NULL 허용 컬럼 추가(ADDITIVE) → 기존 데이터 무영향. 선례: 20260520120000_clinics_nhis_fax
-- 롤백: 20260623160000_clinics_email.rollback.sql

BEGIN;

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN clinics.email IS '병원(기관) 이메일 — 처방전 의료기관 E-mail 주소 바인딩. 환자 이메일과 별개. T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'clinics' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'clinics.email 컬럼 추가 실패';
  END IF;
END $$;

COMMIT;

-- 롤백: T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND
-- clinics.email 컬럼 제거. ADDITIVE nullable 컬럼이므로 제거 시 기존 기능 무영향.

BEGIN;

ALTER TABLE clinics
  DROP COLUMN IF EXISTS email;

COMMIT;

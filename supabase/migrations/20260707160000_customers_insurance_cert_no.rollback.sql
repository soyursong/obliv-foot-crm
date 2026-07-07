-- Rollback: T-20260707-foot-CHART2-INSURANCE-CERTNO-FIELD
-- 주의: 컬럼 DROP 시 저장된 건강보험증 번호 데이터 소실. ADDITIVE 롤백은 데이터 유실 감수 시에만.
BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS insurance_cert_no;

COMMIT;

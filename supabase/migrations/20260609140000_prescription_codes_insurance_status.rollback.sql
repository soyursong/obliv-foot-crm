-- ROLLBACK: T-20260609-foot-DRUG-INSURANCE-GATE Phase1
-- forward : 20260609140000_prescription_codes_insurance_status.sql
--
-- prescription_codes 에 추가한 급여여부 컬럼 3개 + 인덱스 제거.
-- ⚠️ 데이터 손실 주의: insurance_status 값(관리자 수동 설정분)이 함께 삭제된다.
--    롤백 전 백업 필요 시:
--      SELECT id, name_ko, insurance_status, insurance_status_updated_at, insurance_status_source
--      FROM prescription_codes WHERE insurance_status IS NOT NULL;

DROP INDEX IF EXISTS public.idx_prescription_codes_insurance_status;

ALTER TABLE public.prescription_codes
  DROP COLUMN IF EXISTS insurance_status,
  DROP COLUMN IF EXISTS insurance_status_updated_at,
  DROP COLUMN IF EXISTS insurance_status_source;

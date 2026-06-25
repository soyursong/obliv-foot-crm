-- ROLLBACK: T-20260625-foot-PASSPORT-PORT
-- 주의: 컬럼 DROP 시 입력된 국적/여권영문명/외국인등록번호/만료일 데이터 소실.
--   nationalities 테이블도 DROP — 다른 객체가 참조하지 않을 때만 안전(본 마이그가 신규 생성).
--   FK 컬럼(nationality_id)을 먼저 DROP 후 테이블 DROP.

BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS foreign_doc_expiry,
  DROP COLUMN IF EXISTS foreigner_registration_number,
  DROP COLUMN IF EXISTS nationality_id,
  DROP COLUMN IF EXISTS passport_last_name,
  DROP COLUMN IF EXISTS passport_first_name;

DROP TABLE IF EXISTS public.nationalities;

COMMIT;

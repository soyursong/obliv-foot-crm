-- ROLLBACK: T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT
-- 주의: 컬럼 DROP 시 입력된 국적/만료일 데이터 소실.
--   additive nullable 컬럼이므로 passport_number·is_foreign 등 기존 필드엔 영향 없음.

BEGIN;

ALTER TABLE public.customers DROP COLUMN IF EXISTS foreign_doc_expiry;
ALTER TABLE public.customers DROP COLUMN IF EXISTS nationality_code;

COMMIT;

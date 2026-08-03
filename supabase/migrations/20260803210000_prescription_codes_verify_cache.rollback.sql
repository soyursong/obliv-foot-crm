-- ROLLBACK — T-20260803-foot-RXSET-VERIFY-CACHE-AC3
--   up: 20260803210000_prescription_codes_verify_cache.sql
-- 완전 가역: 캐시 6컬럼 DROP. 캐시=비-권위 materialization이므로 소실=순소실 0
--   (읽기부 resolveVerifyVerdict 가 recompute 폴백 → 판정 무손실). 기존 데이터/경로 무변경.
-- 멱등: DROP COLUMN IF EXISTS → 재실행 no-op.

BEGIN;

ALTER TABLE public.prescription_codes
  DROP COLUMN IF EXISTS verify_status,
  DROP COLUMN IF EXISTS verify_ingredient,
  DROP COLUMN IF EXISTS verify_matched_code,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verify_input_hash,
  DROP COLUMN IF EXISTS verify_model_version;

COMMIT;

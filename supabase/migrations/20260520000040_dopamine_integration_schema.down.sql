-- ROLLBACK: T-20260520-foot-DOPAMINE-SCHEMA (TA1)
-- 풋CRM ↔ 도파민 연동 스키마 롤백
-- 적용 순서: down 파일은 up의 역순

BEGIN;

-- 4) dopamine_outbound_log 삭제
DROP TABLE IF EXISTS public.dopamine_outbound_log;

-- 3) payments.external_id 제거
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS external_id;

-- 2) reservations UNIQUE partial index 삭제
DROP INDEX IF EXISTS public.uq_reservations_source_external;

-- 1) reservations 컬럼 제거
ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS source_system;

COMMIT;

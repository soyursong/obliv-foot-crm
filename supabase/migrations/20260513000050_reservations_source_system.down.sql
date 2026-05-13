-- T-20260512-foot-CONTRACT-ALIGN §C — ROLLBACK
-- reservations source_system/external_id 제거 + RPC 제거

BEGIN;

-- RPC 제거
DROP FUNCTION IF EXISTS public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT
);

-- UNIQUE 인덱스 제거
DROP INDEX IF EXISTS public.idx_reservations_source_external;

-- 컬럼 제거
--  ⚠️  데이터가 이미 들어있다면 주의. 롤백 전 아래 쿼리로 확인:
--  SELECT count(*) FROM reservations WHERE source_system IS NOT NULL;
ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS source_system,
  DROP COLUMN IF EXISTS external_id;

COMMIT;

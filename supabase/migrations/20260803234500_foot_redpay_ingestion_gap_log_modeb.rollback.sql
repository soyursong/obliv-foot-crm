-- ============================================================================
-- ROLLBACK — T-20260803-foot-REDPAY-NOTXN-SCAN-3STATE-MODEB-PERSIST
--   전량 ADDITIVE 이식의 역방향. 신규 테이블/RPC 제거 + ledger 엔트리 원복.
--   change-class=ADDITIVE(DA §5) → rollback = DROP(가역, 기존 스키마 무변경).
--
-- ⚠ redpay_ingestion_gap_log 는 관측성 로그(비-PHI). DROP 시 open/resolved 이력 소실 —
--    운영 중 롤백이면 data_correction_backfill_sop §0(archive-first) 준하여 DROP 전 스냅샷 권고.
--    (append-only 초기 · 결제/수납/매칭 원장과 무관 → 순소실 blast-radius = nil.)
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_redpay_ingestion_gap_persist(text,date,integer,bigint,text,text,text,text);

DROP TABLE IF EXISTS public.redpay_ingestion_gap_log;

-- ledger 엔트리 원복
DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260803234500';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK: T-20260609-foot-HIRA-INSURANCE-BATCH Phase2
-- forward : 20260609160000_insurance_sync_runs.sql
--
-- insurance_sync_runs 테이블 + 정책 + 인덱스 제거.
-- ⚠️ 동기화 실행 이력(감사 로그)이 함께 삭제된다. prescription_codes.insurance_status 값은 무영향.
--    (본 롤백은 Phase1 컬럼/게이트를 건드리지 않음.)
--    이력 보존 필요 시:
--      SELECT * FROM insurance_sync_runs ORDER BY started_at DESC;

DROP POLICY IF EXISTS "insurance_sync_runs_read_admin" ON public.insurance_sync_runs;
DROP INDEX IF EXISTS public.idx_insurance_sync_runs_started;
DROP TABLE IF EXISTS public.insurance_sync_runs;

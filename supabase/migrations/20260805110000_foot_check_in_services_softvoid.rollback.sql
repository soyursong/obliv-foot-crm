-- Rollback: T-20260804-foot-COSMETIC-CORRECTION-CRM — check_in_services soft-void 3컬럼 제거.
--   forward-only 컬럼(배포 직후 전건 NULL) → 데이터 손실 0.
--   ⚠ 롤백 전 반드시 FE/집계의 `voided_at IS NULL` (.is('voided_at', null)) 필터 코드도 동시 롤백할 것
--     (컬럼 제거 후 필터 쿼리 실행 시 PostgREST "column does not exist" 오류).
--   ⚠ 4-PK freeze(voided_at 세팅)가 이미 apply 됐다면 컬럼 DROP 시 그 무효화 마킹도 소실됨 —
--     freeze 원복은 _04_freeze_apply.mjs 의 rollback 절 참조(voided_at=NULL) 후 컬럼 DROP.
BEGIN;

ALTER TABLE check_in_services DROP COLUMN IF EXISTS voided_at;
ALTER TABLE check_in_services DROP COLUMN IF EXISTS voided_reason;
ALTER TABLE check_in_services DROP COLUMN IF EXISTS voided_by;

COMMIT;

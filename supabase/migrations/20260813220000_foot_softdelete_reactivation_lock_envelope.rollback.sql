-- ============================================================
-- ROLLBACK — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK Leg2 envelope
-- ============================================================
-- ★REWORK(Q3 BINDING): canonical envelope = deleted_at/deleted_by/deleted_reason 3컬럼(is_deleted 미포함).
-- ⚠ 롤백 전: 어느 테이블이든 deleted_at IS NOT NULL(soft-delete 마킹된 행) 이 존재하면 컬럼 DROP 시
--   그 무효화 마킹이 소실된다 → 실데이터 정합 검토 후에만 DROP. (envelope 미apply 상태면 무영향.)
-- ⚠ FE 라우팅(soft UPDATE) 이 배포된 뒤라면 반드시 FE 롤백을 동시/선행할 것.
-- ============================================================

BEGIN;

ALTER TABLE customers                DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
ALTER TABLE reservations             DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
ALTER TABLE packages                 DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
ALTER TABLE chart_treatment_requests DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
ALTER TABLE patient_file_records     DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
ALTER TABLE reservation_memo_history DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;

COMMIT;

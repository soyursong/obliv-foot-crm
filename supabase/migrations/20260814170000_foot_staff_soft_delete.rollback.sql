-- ============================================================
-- ROLLBACK: T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT — staff soft-delete
-- ============================================================
-- ⚠️ deleted_at 이 세팅된 행이 존재하면 롤백 후 그 '삭제됨' 상태가 소실되어 목록에 재출현한다
--   (FE 필터 deleted_at IS NULL 도 컬럼 부재 시 무의미). 운영 롤백은 삭제행 부재 확인 후 승인 전제.
-- ADDITIVE 역연산 — 신규 3컬럼 + partial index 만 제거. 기존 데이터 무손실.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_staff_active_not_deleted;

ALTER TABLE staff
  DROP COLUMN IF EXISTS deleted_reason,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at;

COMMIT;

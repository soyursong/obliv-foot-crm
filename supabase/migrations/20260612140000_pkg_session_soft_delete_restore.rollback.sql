-- ROLLBACK: T-20260612-foot-USAGEHIST-DELETE-RESTORE
-- ⚠️ 롤백 전: 'deleted' 상태 row가 남아있으면 CHECK 복원이 실패함.
--    복원 정책 결정 필요 — (a) 'deleted' → 'used' 환원(잔여횟수 다시 차감됨) 또는 (b) 물리삭제.
--    아래는 (b) 보수적: 롤백 시점의 deleted row를 물리삭제(원래 hard-delete 의도였던 row).
DELETE FROM package_sessions WHERE status = 'deleted';

DROP FUNCTION IF EXISTS restore_package_session(UUID);
DROP FUNCTION IF EXISTS soft_delete_package_session(UUID);

ALTER TABLE package_sessions DROP CONSTRAINT IF EXISTS package_sessions_status_check;
ALTER TABLE package_sessions ADD CONSTRAINT package_sessions_status_check
  CHECK (status IN ('used','cancelled','refunded'));

ALTER TABLE package_sessions DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE package_sessions DROP COLUMN IF EXISTS deleted_at;

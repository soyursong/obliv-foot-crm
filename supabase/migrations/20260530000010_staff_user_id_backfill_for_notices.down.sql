-- ============================================================================
-- ROLLBACK: T-20260530-foot-NOTICE-CREATEDBY-BACKFILL staff.user_id 백필 되돌리기
-- ============================================================================
-- 이 마이그레이션(20260530000010)이 새로 채운 staff.user_id 만 NULL 로 복원.
-- 기준: _backup_staff_user_id_20260530 스냅샷에서 user_id IS NULL 이었던 row 만 복원.
--   → 이전 마이그레이션(20260426/20260523)이 이미 채워둔 매핑은 보존.
-- notices 데이터는 본 작업에서 손대지 않았으므로 롤백 대상 아님.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = '_backup_staff_user_id_20260530'
  ) THEN
    -- 백업 시점에 NULL 이었던 staff 만 NULL 로 되돌림 (이 마이그레이션이 채운 것만)
    UPDATE staff s
       SET user_id = NULL
      FROM _backup_staff_user_id_20260530 b
     WHERE s.id = b.id
       AND b.user_id IS NULL
       AND s.user_id IS NOT NULL;

    RAISE NOTICE '[notice-backfill rollback] staff.user_id 복원 완료 (백업 시점 NULL 건만).';

    DROP TABLE _backup_staff_user_id_20260530;
  ELSE
    RAISE NOTICE '[notice-backfill rollback] 백업 테이블 없음 — 복원 건너뜀 (이미 롤백되었거나 백필 미적용).';
  END IF;
END $$;

COMMIT;

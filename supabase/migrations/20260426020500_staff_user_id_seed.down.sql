-- ============================================================================
-- T-20260426-foot-052 ROLLBACK: staff.user_id 시드 복원
-- ============================================================================
-- _backup_staff_user_id_20260426 테이블에서 시드 전 user_id 복원.
-- 백업 테이블이 없으면 안전 fallback (전체 NULL 처리).
-- ============================================================================

BEGIN;

-- 1) 백업 테이블 존재 여부 확인 후 복원
DO $$
DECLARE
  v_has_backup BOOLEAN;
  v_restored INT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='_backup_staff_user_id_20260426'
  ) INTO v_has_backup;

  IF v_has_backup THEN
    -- 백업으로 정확 복원 (시드로 매핑된 row만 user_id 되돌림)
    UPDATE staff s
       SET user_id = b.user_id
      FROM _backup_staff_user_id_20260426 b
     WHERE s.id = b.id
       AND s.user_id IS DISTINCT FROM b.user_id;
    GET DIAGNOSTICS v_restored = ROW_COUNT;
    RAISE NOTICE '[foot-052 rollback] restored % rows from backup', v_restored;

    -- 백업 테이블 정리
    DROP TABLE _backup_staff_user_id_20260426;
    RAISE NOTICE '[foot-052 rollback] backup table dropped';
  ELSE
    -- 백업이 없으면 안전 fallback: 시드로 추정되는 매핑 모두 NULL 처리는 위험.
    -- 보수적으로 아무것도 하지 않고 경고만 출력.
    RAISE NOTICE '[foot-052 rollback] backup table not found — manual review required';
  END IF;
END $$;

COMMIT;

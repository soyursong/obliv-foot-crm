-- ROLLBACK — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP2+STEP4 (되돌림)
--   20260802170001_..._createdby_classa_backfill.sql 원복 — 센티넬 backfill 을 NULL 로 재설정.
--   author: dev-foot / 2026-08-02
--
-- ⚠ forward-only 원칙상 통상 롤백 불요. 긴급 원복 시에만 사용.
--   원복 = backfill 이 바꾼 정확한 집합(_backup 스냅샷)에 대해서만 created_by 를 사전값(NULL)로 재설정.
--   ★ new_created_by(legacy-unattributed)와 현재 값이 일치하는 행만 재-NULL(그 사이 다른 값이 들어갔으면
--     건드리지 않음 — 사후 정당 입력 보호).
--   ★ STEP5(NOT NULL 제약)가 이미 apply 됐다면 본 롤백(→NULL)은 제약 위반으로 실패 → STEP5 선 롤백 필요.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_reverted int;
  v_snap_cnt int;
BEGIN
  IF to_regclass('_backup.foot_schema_mig_createdby_classa_backfill_20260802') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: _backup 스냅샷 테이블 부재 — 원복 원천 없음(backfill 미실행 or 스냅샷 유실)';
  END IF;

  SELECT count(*) INTO v_snap_cnt
  FROM _backup.foot_schema_mig_createdby_classa_backfill_20260802;

  UPDATE supabase_migrations.schema_migrations m
  SET created_by = NULL                                   -- = prior_created_by
  FROM _backup.foot_schema_mig_createdby_classa_backfill_20260802 b
  WHERE m.version = b.version
    AND m.created_by IS NOT DISTINCT FROM b.new_created_by;   -- = 'legacy-unattributed' 인 행만
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RAISE NOTICE 'ROLLBACK OK: % / % 행 created_by 재-NULL(스냅샷 대비). 차이=사후 값변경(보호, 미변경).',
    v_reverted, v_snap_cnt;
END $$;

COMMIT;

-- (선택) 스냅샷 정리 — 원복 검증 후 수동:
--   DROP TABLE IF EXISTS _backup.foot_schema_mig_createdby_classa_backfill_20260802;

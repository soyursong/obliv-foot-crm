-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP2+STEP4
--   20260802170001_..._createdby_classa_backfill.sql 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   freeze count·would-UPDATE ROW_COUNT·rows-affected assert·phantom 보존검증을 실제 통과시키되 무영속.
--   ★ txn-control 문 없음 → sentinel-bypass hazard 무. 사후 무영속 introspection = supervisor post-probe
--     (created_by NULL 카운트 = 179 불변 재확인).
--   ⚠ 본 dry-run 은 STEP3(content_checksum 컬럼) apply 여부와 무관(backfill 은 created_by 축만 사용).
--   ⚠ dev DB(원장 상이)에서는 freeze <> 178 → 설계된 abort. prod(supervisor DB-gate)에서만 유의미.
-- =========================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS _backup;

DO $$
DECLARE
  v_freeze_cnt   int;
  v_updated      int;
  v_phantom_null int;
  c_expected     constant int := 178;
BEGIN
  CREATE TEMP TABLE _classa_target_dry ON COMMIT DROP AS
  SELECT version, name, created_by
  FROM supabase_migrations.schema_migrations
  WHERE created_by IS NULL
    AND version <> '20260724200000'
    AND version <  '20260802170000';

  SELECT count(*) INTO v_freeze_cnt FROM _classa_target_dry;
  RAISE NOTICE '[DRY-RUN] freeze class-a = % (prod 기대 %; dev 는 불일치 정상)', v_freeze_cnt, c_expected;

  IF v_freeze_cnt <> c_expected THEN
    RAISE NOTICE '[DRY-RUN] freeze % ≠ 기대 % → 실행 마이그에서 ABORT(target drift/dev DB). prod 재확인 필요.', v_freeze_cnt, c_expected;
  ELSE
    UPDATE supabase_migrations.schema_migrations m
    SET created_by = 'legacy-unattributed'
    FROM _classa_target_dry t
    WHERE m.version = t.version
      AND m.created_by IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> v_freeze_cnt THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: would-UPDATE % ≠ freeze % — target drift', v_updated, v_freeze_cnt;
    END IF;

    SELECT count(*) INTO v_phantom_null
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260724200000' AND created_by IS NULL;
    IF v_phantom_null <> 1 THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: phantom 20260724200000 NULL 기대 1행, 실제 %', v_phantom_null;
    END IF;

    RAISE NOTICE '[DRY-RUN] would-UPDATE=% (=freeze). rows-affected assert PASS. phantom NULL 보존 확인. ROLLBACK 으로 무영속.', v_updated;
  END IF;
END $$;

ROLLBACK;

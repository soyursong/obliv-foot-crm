-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP7
--   20260810125000_..._createdby_classa_rebackfill_step7.sql 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   (★2026-08-16 renumber: 구 20260810120000 = cosmetic_cis_reinsert 원장 점유 → STEP7 을 125000 으로 이동)
--   freeze count(28)·would-UPDATE ROW_COUNT·rows-affected assert·phantom 보존검증(oob-unreconciled)을
--   실제 통과시키되 무영속.
--   ★ txn-control 문 없음(COMMIT/제어문 부재) → sentinel-bypass hazard 무(Migration Dry-Run No-Persistence 표준).
--     사후 무영속 introspection = supervisor post-probe(created_by NULL 카운트 = 28 불변 재확인).
--   ⚠ dev DB(원장 상이)에서는 freeze <> 28 → 설계된 skip-notice. prod(supervisor DB-GATE)에서만 유의미.
-- =========================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS _backup;

DO $$
DECLARE
  v_freeze_cnt    int;
  v_updated       int;
  v_phantom_null  int;
  v_phantom_mark  int;
  c_expected      constant int  := 28;
  c_phantom       constant text := '20260724200000';
BEGIN
  CREATE TEMP TABLE _classa_target_step7_dry ON COMMIT DROP AS
  SELECT version, name, created_by
  FROM supabase_migrations.schema_migrations
  WHERE created_by IS NULL
    AND version <> c_phantom;

  SELECT count(*) INTO v_freeze_cnt FROM _classa_target_step7_dry;
  RAISE NOTICE '[DRY-RUN] freeze class-a = % (prod 기대 %; dev 는 불일치 정상)', v_freeze_cnt, c_expected;

  IF v_freeze_cnt <> c_expected THEN
    RAISE NOTICE '[DRY-RUN] freeze % ≠ 기대 % → 실행 마이그에서 ABORT(target drift/dev DB). prod 재확인 필요.', v_freeze_cnt, c_expected;
  ELSE
    UPDATE supabase_migrations.schema_migrations m
    SET created_by = 'legacy-unattributed'
    FROM _classa_target_step7_dry t
    WHERE m.version = t.version
      AND m.created_by IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> v_freeze_cnt THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: would-UPDATE % ≠ freeze % — target drift', v_updated, v_freeze_cnt;
    END IF;

    SELECT count(*) INTO v_phantom_null
    FROM supabase_migrations.schema_migrations
    WHERE version = c_phantom AND created_by IS NULL;
    IF v_phantom_null <> 0 THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: phantom % created_by NULL 기대 0행(STEP5.5 완료), 실제 %', c_phantom, v_phantom_null;
    END IF;

    SELECT count(*) INTO v_phantom_mark
    FROM supabase_migrations.schema_migrations
    WHERE version = c_phantom AND created_by = 'oob-unreconciled';
    IF v_phantom_mark <> 1 THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: phantom % oob-unreconciled 마킹 기대 1행, 실제 %', c_phantom, v_phantom_mark;
    END IF;

    RAISE NOTICE '[DRY-RUN] would-UPDATE=% (=freeze). rows-affected assert PASS. phantom % oob-unreconciled 보존 확인. ROLLBACK 으로 무영속.', v_updated, c_phantom;
  END IF;
END $$;

ROLLBACK;

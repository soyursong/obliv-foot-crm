-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP 5.5 (Option A)
--   20260802170002_..._phantom_oob_reconcile.sql 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   phantom NULL 검증·would-UPDATE ROW_COUNT·정확히 1행 assert 를 실제 통과시키되 무영속.
--   ★ txn-control 문 없음 → sentinel-bypass hazard 무. 사후 무영속 introspection = supervisor post-probe
--     (phantom 20260724200000 created_by 가 여전히 NULL 인지 = 무영속 재확인).
--   ⚠ 본 dry-run 은 STEP2~4 apply 후(phantom NULL 잔존, class-a 178 backfill 완료) prod 에서만 유의미.
--     dev DB(phantom 부재) 에서는 '상태 이상' abort → 설계된 방어(prod 재확인 필요).
-- =========================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS _backup;

DO $$
DECLARE
  v_null_phantom int;
  v_marked       int;
  v_updated      int;
  c_phantom      constant text := '20260724200000';
BEGIN
  SELECT count(*) INTO v_null_phantom
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by IS NULL;

  SELECT count(*) INTO v_marked
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by = 'oob-unreconciled';

  RAISE NOTICE '[DRY-RUN] phantom % : NULL=% / oob-unreconciled=%', c_phantom, v_null_phantom, v_marked;

  IF v_marked = 1 AND v_null_phantom = 0 THEN
    RAISE NOTICE '[DRY-RUN] 이미 마킹됨 → 실행 마이그에서 no-op(멱등).';
  ELSIF v_null_phantom = 1 THEN
    UPDATE supabase_migrations.schema_migrations
    SET created_by = 'oob-unreconciled'
    WHERE version = c_phantom AND created_by IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: would-UPDATE % ≠ 1 — target drift', v_updated;
    END IF;
    RAISE NOTICE '[DRY-RUN] would-UPDATE=1 (phantom → oob-unreconciled). assert PASS. ROLLBACK 으로 무영속.';
  ELSE
    RAISE NOTICE '[DRY-RUN] phantom 상태 이상(NULL=%,marked=%) → 실행 마이그에서 ABORT(재-센서스). dev DB 면 정상.', v_null_phantom, v_marked;
  END IF;
END $$;

ROLLBACK;

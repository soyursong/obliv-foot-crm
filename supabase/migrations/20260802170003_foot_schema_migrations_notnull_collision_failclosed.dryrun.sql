-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP 5 (B1+B5)
--   20260802170003_..._notnull_collision_failclosed.sql 의 DDL(트리거·함수·NOT NULL) 을 실제 실행하되
--   COMMIT 대신 ROLLBACK → 전량 무영속. NULL-잔여 pre-check·phantom marker belt 도 실제 통과 확인.
--   ★ txn-control 문 없음 → sentinel-bypass hazard 무. CREATE FUNCTION/TRIGGER/ALTER 모두 ROLLBACK 시 미영속.
--   사후 무영속 introspection(supervisor post-probe):
--     · trigger trg_foot_schema_migrations_collision_guard 부재(ROLLBACK 후) 재확인.
--     · created_by is_nullable = 'YES' 불변(ROLLBACK 후) 재확인.
--   ⚠ prod 유의미: STEP2~4 + §5.5(170002) apply 후. dev DB(NULL 잔여 or phantom 미마킹)에서는 설계된 abort.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_schema_migrations_collision_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_exist_name     text;
  v_exist_checksum text;
  v_found          boolean := false;
  v_new_checksum   text;
BEGIN
  SELECT name, content_checksum INTO v_exist_name, v_exist_checksum
  FROM supabase_migrations.schema_migrations
  WHERE version = NEW.version
  LIMIT 1;
  v_found := FOUND;
  IF NOT v_found THEN
    RETURN NEW;
  END IF;
  v_new_checksum := coalesce(NEW.content_checksum, md5(coalesce(NEW.statements::text, '')));
  IF (v_exist_name IS DISTINCT FROM NEW.name)
     OR (v_exist_checksum IS DISTINCT FROM v_new_checksum) THEN
    RAISE EXCEPTION '[DRY-RUN] B5 REJECT version % genuine collision', NEW.version
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_foot_schema_migrations_collision_guard
  ON supabase_migrations.schema_migrations;
CREATE TRIGGER trg_foot_schema_migrations_collision_guard
  BEFORE INSERT ON supabase_migrations.schema_migrations
  FOR EACH ROW EXECUTE FUNCTION public.foot_schema_migrations_collision_guard();

DO $$
DECLARE
  v_null     int;
  v_nullable text;
  v_phantom_marked int;
  c_phantom  constant text := '20260724200000';
BEGIN
  SELECT count(*) INTO v_null FROM supabase_migrations.schema_migrations WHERE created_by IS NULL;
  RAISE NOTICE '[DRY-RUN] created_by NULL 잔여 = % (prod 기대 0; dev 는 불일치 정상)', v_null;
  IF v_null <> 0 THEN
    RAISE NOTICE '[DRY-RUN] NULL 잔여 %≠0 → 실행 마이그에서 ABORT(§5.5/backfill 미선행 or dev DB). prod 재확인.', v_null;
  ELSE
    SELECT count(*) INTO v_phantom_marked FROM supabase_migrations.schema_migrations
      WHERE version = c_phantom AND created_by = 'oob-unreconciled';
    IF v_phantom_marked <> 1 THEN
      RAISE NOTICE '[DRY-RUN] phantom % oob-unreconciled=% ≠ 1 → 실행 마이그 ABORT(§5.5 선행).', c_phantom, v_phantom_marked;
    ELSE
      SELECT is_nullable INTO v_nullable FROM information_schema.columns
        WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by';
      IF v_nullable = 'YES' THEN
        ALTER TABLE supabase_migrations.schema_migrations ALTER COLUMN created_by SET NOT NULL;
        RAISE NOTICE '[DRY-RUN] would-apply: created_by SET NOT NULL. ROLLBACK 으로 무영속.';
      ELSE
        RAISE NOTICE '[DRY-RUN] created_by 이미 NOT NULL → no-op(멱등).';
      END IF;
    END IF;
  END IF;
END $$;

ROLLBACK;

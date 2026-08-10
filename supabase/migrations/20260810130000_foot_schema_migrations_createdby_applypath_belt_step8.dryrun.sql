-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP8 (apply-path belt)
--   20260810130000_..._createdby_applypath_belt_step8.sql 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   belt 함수/트리거 생성 + 착지 자기검증 + belt 실동작(미지정 INSERT → cli-apply 센티넬 stamp)을
--   실제 통과시키되 무영속.
--   ★ txn-control 문 없음(COMMIT/제어문 부재) → sentinel-bypass hazard 무(Migration Dry-Run No-Persistence 표준).
--     사후 무영속 introspection = supervisor post-probe(belt 트리거 부재·더미행 0 재확인).
--   ⚠ 이 dryrun 은 prod/dev 무관 유의미(원장 상태 의존 없음 = belt 는 구조 변경). 단 물리 apply 는 supervisor DB-GATE.
-- =========================================================================

BEGIN;

-- belt 함수/트리거 생성(main 과 동일).
CREATE OR REPLACE FUNCTION public.foot_schema_migrations_createdby_belt()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_actor text;
BEGIN
  IF NEW.created_by IS NOT NULL AND btrim(NEW.created_by) <> '' THEN
    RETURN NEW;
  END IF;
  v_actor := nullif(btrim(current_setting('app.apply_actor', true)), '');
  IF v_actor IS NULL THEN
    v_actor := 'cli-apply:' || current_user;
  END IF;
  NEW.created_by := v_actor;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_foot_schema_migrations_createdby_belt
  ON supabase_migrations.schema_migrations;
CREATE TRIGGER trg_foot_schema_migrations_createdby_belt
  BEFORE INSERT ON supabase_migrations.schema_migrations
  FOR EACH ROW
  EXECUTE FUNCTION public.foot_schema_migrations_createdby_belt();

DO $$
DECLARE
  v_trg      int;
  v_stamped  text;
  v_dummy_v  constant text := '29990102000801';   -- 미래 더미 version(원장 미충돌), ROLLBACK 으로 무영속
BEGIN
  -- (a) belt 착지 검증
  SELECT count(*) INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'
    AND t.tgname = 'trg_foot_schema_migrations_createdby_belt' AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION '[DRY-RUN] ABORT: belt 트리거 착지 실패(count=%)', v_trg;
  END IF;
  RAISE NOTICE '[DRY-RUN] belt 트리거 착지 OK.';

  -- (b) belt 실동작: created_by 미지정 INSERT → 센티넬 stamp 확인(무영속 더미행)
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES (v_dummy_v, 'dryrun_belt_probe');
  SELECT created_by INTO v_stamped
  FROM supabase_migrations.schema_migrations WHERE version = v_dummy_v;
  IF v_stamped IS NULL OR v_stamped NOT LIKE 'cli-apply:%' THEN
    RAISE EXCEPTION '[DRY-RUN] ABORT: belt stamp 실패 — created_by=% (기대 cli-apply:*)', coalesce(v_stamped, '(NULL)');
  END IF;
  RAISE NOTICE '[DRY-RUN] belt stamp OK: 미지정 INSERT → created_by=% (cli-apply 센티넬). ROLLBACK 으로 무영속.', v_stamped;
END $$;

ROLLBACK;

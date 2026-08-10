-- NEGATIVE/INTEGRATION TEST (post-apply, No-Persistence) — T-20260802 STEP8 belt (AC8)
--   20260810130000(apply-path belt) apply 후 실행 → belt 의 실제 stamp 동작 + STEP5(NOT NULL)/B5(collision)
--   와의 통합을 실증. 전량 BEGIN … ROLLBACK → 무영속(fixture INSERT 도 미영속).
--   PASS 조건: 모든 'AC8-* PASS' NOTICE 출력 + 어떤 assert 도 EXCEPTION 으로 중단되지 않음.
--   ★ 29990102* = 미래 더미 version(원장 미충돌). supervisor code-gate/DB-gate post-apply 검증에 사용.
--
--   ⚠ AC8-4(핵심)는 STEP5(NOT NULL)까지 apply 된 상태에서 belt 가 apply outage 를 막는지 실증한다.
--     STEP5 미적용 상태에서 실행하면 AC8-4b(belt 제거 시 not_null 거부)는 skip-notice(제약 부재)로 관측된다.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_stamped   text;
  v_caught    boolean;
  v_notnull   boolean;
  v_cnt       int;
BEGIN
  -- NOT NULL(STEP5) 적용 여부 사전 조회(AC8-4 분기용).
  SELECT (is_nullable = 'NO') INTO v_notnull
  FROM information_schema.columns
  WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by';
  RAISE NOTICE '[ctx] created_by NOT NULL 적용 = % (STEP5)', v_notnull;

  -- ── AC8-1: created_by 미지정(정상 CLI 경로) INSERT → belt 가 cli-apply 센티넬 stamp ──
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES ('29990102000001', 'negtest_belt_cli');
  SELECT created_by INTO v_stamped FROM supabase_migrations.schema_migrations WHERE version='29990102000001';
  IF v_stamped IS NULL OR v_stamped NOT LIKE 'cli-apply:%' THEN
    RAISE EXCEPTION 'AC8-1 FAIL: 미지정 INSERT created_by=% (기대 cli-apply:*)', coalesce(v_stamped,'(NULL)');
  END IF;
  RAISE NOTICE 'AC8-1 PASS: 미지정 INSERT → belt stamp created_by=% (cli-apply 센티넬).', v_stamped;

  -- ── AC8-2: 명시 created_by INSERT → belt 무접촉(명시값 존치·최우선) ──
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by)
  VALUES ('29990102000002', 'negtest_belt_explicit', 'dev-foot:explicit-stamp');
  SELECT created_by INTO v_stamped FROM supabase_migrations.schema_migrations WHERE version='29990102000002';
  IF v_stamped IS DISTINCT FROM 'dev-foot:explicit-stamp' THEN
    RAISE EXCEPTION 'AC8-2 FAIL: 명시 created_by 가 belt 에 의해 변경됨 (=%)', v_stamped;
  END IF;
  RAISE NOTICE 'AC8-2 PASS: 명시 created_by 존치(belt 무접촉) = %.', v_stamped;

  -- ── AC8-3: GUC app.apply_actor 주입 + created_by 미지정 → belt 가 GUC 값 stamp(러너 진위 주입 통로) ──
  PERFORM set_config('app.apply_actor', 'dev-foot:runner-provenance', true);  -- is_local=true(txn scope)
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES ('29990102000003', 'negtest_belt_guc');
  SELECT created_by INTO v_stamped FROM supabase_migrations.schema_migrations WHERE version='29990102000003';
  IF v_stamped IS DISTINCT FROM 'dev-foot:runner-provenance' THEN
    RAISE EXCEPTION 'AC8-3 FAIL: GUC app.apply_actor 주입 stamp 실패 (=%)', v_stamped;
  END IF;
  PERFORM set_config('app.apply_actor', '', true);  -- 정리(후속 케이스 오염 방지)
  RAISE NOTICE 'AC8-3 PASS: GUC app.apply_actor → belt stamp = % (러너 진위 주입 통로).', v_stamped;

  -- ── AC8-3b: 명시값 > GUC 우선순위(둘 다 있으면 명시값 존치) ──
  PERFORM set_config('app.apply_actor', 'guc-should-lose', true);
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by)
  VALUES ('29990102000004', 'negtest_belt_priority', 'explicit-should-win');
  SELECT created_by INTO v_stamped FROM supabase_migrations.schema_migrations WHERE version='29990102000004';
  PERFORM set_config('app.apply_actor', '', true);
  IF v_stamped IS DISTINCT FROM 'explicit-should-win' THEN
    RAISE EXCEPTION 'AC8-3b FAIL: 명시값>GUC 우선순위 위반 (=%)', v_stamped;
  END IF;
  RAISE NOTICE 'AC8-3b PASS: 우선순위 명시값 > GUC 확인 = %.', v_stamped;

  -- ── AC8-4a (★핵심 통합): belt 활성 상태에서 정상 CLI 경로(미지정) INSERT 가 성공 = apply outage 없음 ──
  --   위 AC8-1 이 이미 실증(NOT NULL 적용 여부와 무관하게 belt stamp → non-NULL → NOT NULL 만족).
  --   NOT NULL 적용 상태에서도 미지정 INSERT 가 거부되지 않았음을 명시 재확인.
  SELECT count(*) INTO v_cnt FROM supabase_migrations.schema_migrations WHERE version='29990102000001';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'AC8-4a FAIL: belt 활성 시 정상 CLI 미지정 INSERT 실패 — apply outage(행수 %)', v_cnt;
  END IF;
  IF v_notnull THEN
    RAISE NOTICE 'AC8-4a PASS: NOT NULL 활성 + belt → 정상 CLI 미지정 INSERT 성공(apply outage 없음). belt=load-bearing.';
  ELSE
    RAISE NOTICE 'AC8-4a PASS: belt → 정상 CLI 미지정 INSERT 성공. (NOT NULL 미적용 상태 — STEP5 apply 후 재검증 권고).';
  END IF;

  -- ── AC8-4b (belt load-bearing 실증): belt 제거 후, NOT NULL 활성이면 미지정 INSERT 는 거부되어야 함 ──
  DROP TRIGGER IF EXISTS trg_foot_schema_migrations_createdby_belt ON supabase_migrations.schema_migrations;
  IF v_notnull THEN
    v_caught := false;
    BEGIN
      INSERT INTO supabase_migrations.schema_migrations(version, name)
      VALUES ('29990102000005', 'negtest_belt_removed');
    EXCEPTION WHEN not_null_violation THEN
      v_caught := true;
    END;
    IF NOT v_caught THEN
      RAISE EXCEPTION 'AC8-4b FAIL: belt 제거+NOT NULL 인데 미지정 INSERT 가 거부되지 않음 — belt 가 load-bearing 아님?';
    END IF;
    RAISE NOTICE 'AC8-4b PASS: belt 제거 시 미지정 INSERT 거부(not_null) → belt 가 apply outage 를 막고 있었음(load-bearing 실증).';
  ELSE
    RAISE NOTICE 'AC8-4b SKIP: NOT NULL 미적용(STEP5 미apply) → belt 제거해도 미지정 INSERT 허용. STEP5 apply 후 재검증 시 거부 관측 예정.';
  END IF;
  -- belt 복원(트랜잭션 무영속이지만 이후 케이스 정합 위해 재생성).
  CREATE TRIGGER trg_foot_schema_migrations_createdby_belt
    BEFORE INSERT ON supabase_migrations.schema_migrations
    FOR EACH ROW EXECUTE FUNCTION public.foot_schema_migrations_createdby_belt();

  RAISE NOTICE '=== AC8 ALL PASS === (belt stamp / 명시 존치 / GUC 주입 / 우선순위 / NOT NULL 통합 apply outage 방지 / belt load-bearing). ROLLBACK 으로 무영속.';
END $$;

ROLLBACK;

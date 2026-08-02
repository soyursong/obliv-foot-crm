-- NEGATIVE TEST (post-apply, No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT AC4+AC5
--   20260802170003(B1 NOT NULL + B5 트리거) apply 후 실행 → 제약·트리거의 실제 거부/통과를 실증.
--   전량 BEGIN … ROLLBACK → 무영속(fixture INSERT 도 미영속).
--   PASS 조건: 4개 RAISE NOTICE '... PASS' 모두 출력 + 어떤 assert 도 EXCEPTION 으로 중단되지 않음.
--     (assert 실패 시 RAISE EXCEPTION 으로 트랜잭션 abort → FAIL 로 관측)
--   ★ 29990101* = 미래 더미 version(원장 미충돌). supervisor DB-gate post-apply 검증에 사용.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_caught boolean;
  v_cnt    int;
BEGIN
  -- ── AC4: actor-less INSERT(created_by 생략) → NOT NULL 거부 ──
  v_caught := false;
  BEGIN
    INSERT INTO supabase_migrations.schema_migrations(version, name)
    VALUES ('29990101000001', 'negtest_actorless');
  EXCEPTION WHEN not_null_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'AC4 FAIL: actor-less INSERT(created_by 생략)가 거부되지 않음 — NOT NULL 미적용';
  END IF;
  RAISE NOTICE 'AC4 PASS: actor-less INSERT rejected (NOT NULL, actor-less 물리거부).';

  -- ── fixture: base 행(정상 stamp, 알려진 checksum) ──
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
  VALUES ('29990101000002', 'negtest_base', 'dev-foot:negtest', md5('AAA'));

  -- ── AC5-a: genuine collision(동일 version + 상이 identity) → B5 fail-closed REJECT ──
  v_caught := false;
  BEGIN
    INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
    VALUES ('29990101000002', 'negtest_DIFFERENT', 'dev-foot:negtest', md5('BBB'));
  EXCEPTION WHEN unique_violation THEN
    v_caught := true;   -- 트리거 RAISE(ERRCODE unique_violation)
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'AC5-a FAIL: genuine collision(동일 version+상이 identity)이 REJECT 되지 않음';
  END IF;
  RAISE NOTICE 'AC5-a PASS: genuine collision REJECT (silent skip 금지, V4 차단).';

  -- ── AC5-b: 멱등 replay(동일 version + 동일 identity) + ON CONFLICT DO NOTHING → 존치(무에러·무중복) ──
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
  VALUES ('29990101000002', 'negtest_base', 'dev-foot:negtest', md5('AAA'))
  ON CONFLICT (version) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM supabase_migrations.schema_migrations WHERE version = '29990101000002';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'AC5-b FAIL: 멱등 replay 후 version 29990101000002 행수 %≠1', v_cnt;
  END IF;
  RAISE NOTICE 'AC5-b PASS: 멱등 replay(동일 identity) DO NOTHING 존치 (무에러·무중복).';

  -- ── AC5-c: 선재 pending 무회귀(신규 version, 원장 미존재) → 정상 INSERT ──
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
  VALUES ('29990101000003', 'negtest_pending', 'dev-foot:negtest', md5('CCC'));
  SELECT count(*) INTO v_cnt FROM supabase_migrations.schema_migrations WHERE version = '29990101000003';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'AC5-c FAIL: 신규 version(255 pending류) 정상 INSERT 실패 — 무회귀 위반';
  END IF;
  RAISE NOTICE 'AC5-c PASS: 신규 version 정상 INSERT (선재 255 pending 무회귀).';

  RAISE NOTICE '=== AC4/AC5 ALL PASS === (actor-less REJECT / collision REJECT / 멱등 존치 / pending 무회귀). ROLLBACK 으로 무영속.';
END $$;

ROLLBACK;

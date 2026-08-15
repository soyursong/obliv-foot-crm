-- NEGATIVE TEST (post-apply, No-Persistence) — T-20260802 AC4′(belt-aware) + AC5-a/b/c
--   ★배경: 원 170003 negtest 는 2026-08-02 STEP8 belt 존재 前 저작 → AC4 를 "belt 부재" 세계에서
--     "actor-less INSERT → NOT NULL 물리거부" 로 assert. 그러나 승인된 apply 순서[STEP7′→STEP8 belt→STEP5]는
--     belt 를 STEP5 前 착지시키므로, belt(BEFORE INSERT)가 actor-less INSERT 의 created_by 를 cli-apply:<user>
--     로 stamp → non-NULL 착지 → NOT NULL 이 거부하지 않음. 이것이 belt 의 설계목적(apply-outage 방지)이다.
--   ∴ 원 AC4(actor-less REJECT)의 참 invariant 는 belt-present 세계에서 다음 둘로 분해된다:
--     (1) AC4′  : actor-less INSERT → belt stamp cli-apply:* → NULL created_by 착지 물리 불가(본 파일).
--     (2) AC8-4b: belt 제거 시 NOT NULL 이 actor-less 를 거부(load-bearing) — belt.negtest(AC8) 에서 실증.
--   GO-token(MSG-20260816-015602-hbo7) 조건③ 명세 = AC4/AC5(collision fail-closed·멱등 존치·pending 무회귀)
--     + AC8(belt STAMP 우선순위·apply-outage 없음·load-bearing). "actor-less REJECT WITH belt" 는 설계상 불가·미명세.
--   전량 BEGIN … ROLLBACK → 무영속. PASS = 모든 NOTICE 출력 + 어떤 assert 도 EXCEPTION 미발생.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_caught  boolean;
  v_cnt     int;
  v_stamped text;
BEGIN
  -- ── AC4′ (belt-aware): actor-less INSERT → belt stamp cli-apply:* (NULL created_by 물리 불가) ──
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES ('29990101000001', 'negtest_actorless_beltaware');
  SELECT created_by INTO v_stamped FROM supabase_migrations.schema_migrations WHERE version='29990101000001';
  IF v_stamped IS NULL THEN
    RAISE EXCEPTION 'AC4′ FAIL: actor-less INSERT created_by=NULL 착지 — belt stamp 미동작(NULL 물리거부 실패)';
  END IF;
  IF v_stamped NOT LIKE 'cli-apply:%' THEN
    RAISE EXCEPTION 'AC4′ FAIL: actor-less INSERT created_by=% (기대 cli-apply:*)', v_stamped;
  END IF;
  RAISE NOTICE 'AC4′ PASS: actor-less INSERT → belt stamp created_by=% (NULL created_by 물리 불가). (순수 NOT NULL 거부는 AC8-4b 에서 실증)', v_stamped;

  -- ── fixture: base 행(정상 stamp, 알려진 checksum) ──
  INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
  VALUES ('29990101000002', 'negtest_base', 'dev-foot:negtest', md5('AAA'));

  -- ── AC5-a: genuine collision(동일 version + 상이 identity) → B5 fail-closed REJECT ──
  v_caught := false;
  BEGIN
    INSERT INTO supabase_migrations.schema_migrations(version, name, created_by, content_checksum)
    VALUES ('29990101000002', 'negtest_DIFFERENT', 'dev-foot:negtest', md5('BBB'));
  EXCEPTION WHEN unique_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'AC5-a FAIL: genuine collision(동일 version+상이 identity)이 REJECT 되지 않음';
  END IF;
  RAISE NOTICE 'AC5-a PASS: genuine collision REJECT (silent skip 금지, V4 차단).';

  -- ── AC5-b: 멱등 replay(동일 version + 동일 identity) + ON CONFLICT DO NOTHING → 존치 ──
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
  RAISE NOTICE 'AC5-c PASS: 신규 version 정상 INSERT (선재 pending 무회귀).';

  RAISE NOTICE '=== AC4′/AC5 ALL PASS === (belt stamp NULL 물리불가 / collision REJECT / 멱등 존치 / pending 무회귀). ROLLBACK 으로 무영속.';
END $$;

ROLLBACK;

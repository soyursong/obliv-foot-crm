-- DRY-RUN (No-Persistence) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP3
--   20260802170000_foot_schema_migrations_discriminator_additive.sql 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   migration_dryrun_no_persistence 준수: ALTER ADD COLUMN·record-step UPDATE·self-INSERT 전부 ROLLBACK 으로 무영속.
--   ★ txn-control 문 없음(내장 COMMIT 없음) → sentinel-bypass hazard 무. 사후 무영속 introspection 은 supervisor 가
--     post-probe(content_checksum 컬럼 부재 재확인)로 검증.
-- =========================================================================

BEGIN;

ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS content_checksum text;

DO $$
DECLARE
  v_total   int;
  v_filled  int;
  v_remain  int;
BEGIN
  SELECT count(*) INTO v_total FROM supabase_migrations.schema_migrations;
  RAISE NOTICE '[DRY-RUN] 원장 총 % 행 (센서스 STEP1 기대 243+; apply 시점 신규 마이그로 증가 가능)', v_total;

  UPDATE supabase_migrations.schema_migrations
  SET content_checksum = md5(coalesce(statements::text, ''))
  WHERE content_checksum IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SELECT count(*) INTO v_remain
  FROM supabase_migrations.schema_migrations
  WHERE content_checksum IS NULL;

  IF v_remain <> 0 THEN
    RAISE EXCEPTION '[DRY-RUN] ABORT: record-step 후 NULL 잔여 % — 예상 0', v_remain;
  END IF;

  RAISE NOTICE '[DRY-RUN] would-fill content_checksum=% 행 (잔여 NULL=0). record-step 정합. ROLLBACK 으로 무영속.', v_filled;

  -- 유니크성 관측(정보용): 동일 (name, content_checksum) 이면서 상이 version 인 잠재 collision 사전 노출.
  DECLARE v_dupident int;
  BEGIN
    SELECT count(*) INTO v_dupident FROM (
      SELECT name, content_checksum, count(DISTINCT version) c
      FROM supabase_migrations.schema_migrations
      GROUP BY name, content_checksum
      HAVING count(DISTINCT version) > 1
    ) d;
    RAISE NOTICE '[DRY-RUN] 관측: 동일 (name,content_checksum) 다중 version 그룹 = % (STEP5 collision 판정 참고, 본 STEP3 무영향)', v_dupident;
  END;
END $$;

ROLLBACK;

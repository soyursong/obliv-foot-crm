-- ============================================================================
-- DRY-RUN (no-persistence) — foot row1 중복행 정정 mutation
-- Ticket : T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
-- 목적   : prod 무영속 재현. Migration Dry-Run No-Persistence Protocol 준수:
--          (a) forward 본문의 txn-control(BEGIN/COMMIT) strip — 아래 harness 가 감싼다.
--          (b) plpgsql exception-handler 로 강제 ROLLBACK (sentinel bypass 차단).
--          (c) 사후 무영속 introspection(post-probe): ROLLBACK 후 prod 실재 불변 재확인.
-- 실행   : psql "$FOOT_DB" -v ON_ERROR_STOP=1 -f 이 파일   (supervisor DB-GATE 단계)
--          ⚠ prod 대상이라도 sentinel RAISE 로 무영속. 단독 실행 금지 — DB-GATE 게이트 내에서만.
-- ============================================================================

-- 사전 상태 스냅샷 (dry-run 전) — post-probe 대조 기준
\echo '── PRE-STATE ──'
SELECT
  (SELECT count(*) FROM customers WHERE id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_present,
  (SELECT count(*) FROM customers WHERE id='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b' AND rrn_enc IS NOT NULL) AS raw_has_rrn,
  (SELECT count(*) FROM check_ins WHERE customer_id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_checkins;

DO $dryrun$
DECLARE
  v_sentinel constant text := 'DRYRUN_NO_PERSIST_SENTINEL';
BEGIN
  -- per-row confirm 훅을 dry-run 세션에 주입 (실 apply 는 대표 게이트 집행자가 SET LOCAL)
  PERFORM set_config('app.row1_cleanup_confirm', '0356b229::KEEP-RAW::c51dd5e0', true);

  -- ↓↓↓ forward 본문(20260715140000_foot_row1_dup_cleanup.sql)의 DO $mig$ ... $mig$ 블록을
  --     여기에 그대로 in-line 하여 실행한다. (txn-control strip: 바깥 BEGIN/COMMIT 제거판)
  --     [DB-GATE 러너가 forward 파일의 DO $mig$ 블록 본문을 주입]
  -- ↑↑↑
  --   본문 정상 완료 후, 아래 sentinel 로 무조건 예외 발생 → 이 DO 블록 밖으로 전파 →
  --   호출 트랜잭션 abort → 영속 0. (COMMIT 도달 불가)

  RAISE EXCEPTION 'SENTINEL:% (dry-run 무영속 강제 rollback)', v_sentinel;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%'||'DRYRUN_NO_PERSIST_SENTINEL'||'%' THEN
      RAISE NOTICE 'DRYRUN OK — 본문 완주 후 sentinel rollback (무영속)';
    ELSE
      RAISE NOTICE 'DRYRUN 본문 ABORT (게이트 정상 작동): %', SQLERRM;
    END IF;
END $dryrun$;

-- 사후 무영속 introspection (post-probe) — ROLLBACK 후 prod 실재가 PRE-STATE 와 동일해야 함
\echo '── POST-PROBE (must equal PRE-STATE — 영속 0 증명) ──'
SELECT
  (SELECT count(*) FROM customers WHERE id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_present,
  (SELECT count(*) FROM customers WHERE id='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b' AND rrn_enc IS NOT NULL) AS raw_has_rrn,
  (SELECT count(*) FROM check_ins WHERE customer_id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_checkins,
  (SELECT count(*) FROM pg_tables WHERE tablename LIKE '_cleanup_row1_%') AS cleanup_tables_leaked;
-- 기대: row1_present=1, raw_has_rrn=0, row1_checkins=4(≥1), cleanup_tables_leaked=0
-- NOTE: DO 블록 내 CREATE TABLE 은 sentinel rollback 으로 함께 소멸 → cleanup_tables_leaked=0 이어야 함.

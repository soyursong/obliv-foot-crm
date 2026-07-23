-- ============================================================================
-- DRY-RUN (no-persistence) — foot row1 중복행 정정 mutation  [HUMAN-READABLE MIRROR]
-- Ticket : T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
-- ⚠ 권위(authoritative) dry-run = scripts/T-20260715-foot-ROW1-DUP-CLEANUP_dryrun_run.mjs
--   (dryrun_lib.mjs buildHarness 3요소: txn-strip + plpgsql exception-handler + post-probe).
--   Supabase Management API 는 raw BEGIN…ROLLBACK 세션 미지원 → 이 .dryrun.sql 은 사람이
--   읽는 참조 미러일 뿐. 실행은 .mjs 러너로.
-- 표준 : Migration Dry-Run No-Persistence Protocol (sentinel-bypass 차단).
--   (a) forward 본문 top-level txn-control(BEGIN/COMMIT) strip
--   (b) plpgsql exception-handler(DO…EXECUTE…EXCEPTION) 로 강제 rollback (무영속)
--   (c) 사후 무영속 introspection(post-probe): ROLLBACK 후 prod 실재 불변 재확인
-- 러너가 주입하는 것:
--   · SELECT set_config('app.row1_cleanup_confirm','0356b229::KEEP-RAW::c51dd5e0', false); (per-row 훅)
--   · forward 20260715170000_foot_row1_dup_cleanup.sql 전문(strip 후)을 payload 로 EXECUTE
-- 기대(PASS): 본문 G0~G-final 완주(NOTICE 'ROW1_CLEANUP_OK relinked=4 …') →
--             sentinel 강제 rollback → post-probe 전량 ABSENT/불변.
-- ============================================================================

-- 사전 상태 스냅샷 (dry-run 전) — post-probe 대조 기준
-- ★C9 재baseline(2026-07-24 재특성화): ROW1.phone 은 benign DUMMY placeholder 로 drift(07-18).
--   freeze G0 는 ROW1 을 phone_dummy assertion 으로 고정(tail 9089 selector 폐기). RAW 는 tail 9089 유지.
--   러너(.mjs)는 forward .sql 전문을 읽어 EXECUTE → 본 미러 편집 불요, 아래는 사람 참조용.
\echo '── PRE-STATE (prod 실측, C9 재baseline as-of 2026-07-24) ──'
SELECT
  (SELECT count(*) FROM customers WHERE id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_present,          -- 기대 1
  (SELECT count(*) FROM customers WHERE id='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b' AND rrn_enc IS NOT NULL) AS raw_has_rrn,  -- 기대 0
  (SELECT count(*) FROM check_ins WHERE customer_id='0356b229-e8c7-4655-aa6e-651b15370c1f') AS row1_checkins; -- 기대 1

-- ── post-probe (러너 assertAbsent, 각 SQL 은 "안전(무영속)"일 때 absent=TRUE) ──
-- 1) 삭제 미영속: ROW1 여전히 존재
--    SELECT (count(*)=1) AS absent FROM customers WHERE id='0356b229-e8c7-4655-aa6e-651b15370c1f';
-- 2) RRN 이관 미영속: RAW.rrn 여전히 NULL
--    SELECT (count(*)=1) AS absent FROM customers WHERE id='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b' AND rrn_enc IS NULL;
-- 3) relink 미영속: ROW1 4자식 여전히 ROW1 소속
--    SELECT (count(*)=4) AS absent FROM (SELECT customer_id FROM check_ins WHERE customer_id='0356b229…'
--       UNION ALL SELECT customer_id FROM customer_consult_memos WHERE customer_id='0356b229…'
--       UNION ALL SELECT customer_id FROM health_q_results WHERE customer_id='0356b229…'
--       UNION ALL SELECT customer_id FROM health_q_tokens WHERE customer_id='0356b229…') s;
-- 4~7) 아카이브 테이블 미영속: _cleanup_row1_{customers_bak,fkmoves,rrn_bak,denorm} 전부 to_regclass IS NULL
--
-- 기대: 전 probe absent=TRUE → 영속 0 증명.

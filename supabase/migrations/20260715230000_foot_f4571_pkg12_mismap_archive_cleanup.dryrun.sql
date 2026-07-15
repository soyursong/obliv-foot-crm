-- NO-PERSISTENCE DRY-RUN — T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP Phase 2
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 프로토콜: migration_dryrun_no_persistence_standard.md §1
--   (1) txn-control strip     — up.sql(20260715230000_…archive_cleanup.sql)에 COMMIT/BEGIN/SAVEPOINT
--                                등 txn 제어문 없음(순수 CREATE + DO 블록) → strip 대상 0 = sentinel-bypass 없음.
--   (2) plpgsql exception-handler 실행 — 전체 up.sql 본문을 단일 트랜잭션에서 실행 후 sentinel EXCEPTION
--                                발생 → 명시 ROLLBACK 으로 무영속 확정.
--   (3) post-probe             — ROLLBACK 후 archive 테이블/DELETE 효과가 prod에 영속하지 않음을 introspection.
--
-- ⚠ sentinel-bypass hazard: 본 마이그는 archive CREATE(DDL) + DELETE(DML) 혼재. DDL은 Postgres 에서
--   트랜잭션 대상이므로 ROLLBACK 시 함께 revert 되어야 정상. post-probe 에서 to_regclass 가 NULL 이 아니면
--   = 어딘가 COMMIT 누수 = FAIL(영속 발생). supervisor DB-GATE 에서 이 post-probe 결과를 evidence 로 첨부.
--
-- 실행: supervisor DB-GATE(gate3). psql(트랜잭션 제어 지원)로 실행 권장.
--       management query API(단일 statement 자동커밋)로는 BEGIN/ROLLBACK 경계가 보장되지 않으니 psql 사용.
-- author: dev-foot / 2026-07-15
-- ══════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ┌─────────────────────────────────────────────────────────────────────────────────┐
-- │ up.sql 본문 (20260715230000_foot_f4571_pkg12_mismap_archive_cleanup.sql)과 동일   │
-- │ ↓ 무영속 검증을 위해 인라인. 실제 apply 시에는 up.sql 이 정본.                     │
-- └─────────────────────────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS _archive_f4571_pkg12_mismap_packages_20260715
  (LIKE packages INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS _archive_f4571_pkg12_mismap_package_payments_20260715
  (LIKE package_payments INCLUDING DEFAULTS);

DO $$
DECLARE
  v_cust      uuid   := '99784454-1ee5-4c38-b677-7c085b3b19db';
  v_freeze_pkg uuid  := '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
  v_freeze_pp uuid[] := ARRAY['1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86',
                              'e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650']::uuid[];
  v_refunds   uuid[] := ARRAY['e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650']::uuid[];
  v_payments  uuid[] := ARRAY['1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86']::uuid[];
  v_keep_pkg  uuid   := '9a553cbd-621b-435e-ae20-aabc035e363e';
  v_keep_pp   uuid   := 'bc58d34e-0ac8-422c-8a83-c8b6000e0a6d';
  v_keep_pm   uuid   := '01299d6c-d7e1-45bb-894b-ead27c80ac36';
  v_live_pkg int; v_live_pp int; v_arch_pkg int; v_arch_pp int;
  v_fp int; v_net numeric; v_keep_ovl int; v_blast int; v_del int; v_del_pp int; v_del_pkg int;
BEGIN
  SELECT count(*) INTO v_live_pkg FROM packages         WHERE id = v_freeze_pkg;
  SELECT count(*) INTO v_live_pp  FROM package_payments WHERE id = ANY(v_freeze_pp);
  IF v_live_pkg <> 1 OR v_live_pp <> 4 THEN
    RAISE EXCEPTION 'DRYRUN precondition: live pkg=% (exp1) pp=% (exp4) — freeze drift.', v_live_pkg, v_live_pp;
  END IF;

  SELECT count(*) INTO v_fp FROM packages
   WHERE id = v_freeze_pkg AND customer_id = v_cust AND status='refunded' AND package_type='12회권'
     AND paid_amount = total_amount + 10000
     AND id NOT IN (SELECT DISTINCT package_id FROM package_sessions WHERE package_id IS NOT NULL)
     AND id NOT IN (SELECT DISTINCT package_id FROM check_ins        WHERE package_id IS NOT NULL);
  IF v_fp <> 1 THEN RAISE EXCEPTION 'DRYRUN 지문 실패 matched=%.', v_fp; END IF;

  SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0)
       - COALESCE(SUM(CASE WHEN payment_type='refund'  THEN amount ELSE 0 END),0)
    INTO v_net FROM package_payments WHERE package_id = v_freeze_pkg;
  IF v_net <> 0 THEN RAISE EXCEPTION 'DRYRUN net!=0 (net=%).', v_net; END IF;

  v_keep_ovl := (CASE WHEN v_keep_pkg=v_freeze_pkg THEN 1 ELSE 0 END)
              + (SELECT count(*) FROM unnest(v_freeze_pp) f WHERE f IN (v_keep_pp, v_keep_pm))::int;
  IF v_keep_ovl <> 0 THEN RAISE EXCEPTION 'DRYRUN KEEP∩freeze=%.', v_keep_ovl; END IF;

  SELECT (SELECT count(*) FROM check_ins        WHERE package_id=v_freeze_pkg)
       + (SELECT count(*) FROM package_sessions WHERE package_id=v_freeze_pkg)
       + (SELECT count(*) FROM packages         WHERE transferred_from=v_freeze_pkg OR transferred_to=v_freeze_pkg)
       + (SELECT count(*) FROM claim_diagnoses  WHERE package_payment_id = ANY(v_freeze_pp))
       + (SELECT count(*) FROM package_payments WHERE parent_payment_id = ANY(v_freeze_pp) AND NOT (id = ANY(v_freeze_pp)))
    INTO v_blast;
  IF v_blast <> 0 THEN RAISE EXCEPTION 'DRYRUN blast=%.', v_blast; END IF;

  INSERT INTO _archive_f4571_pkg12_mismap_packages_20260715
  SELECT p.* FROM packages p WHERE p.id = v_freeze_pkg
     AND NOT EXISTS (SELECT 1 FROM _archive_f4571_pkg12_mismap_packages_20260715 a WHERE a.id=p.id);
  INSERT INTO _archive_f4571_pkg12_mismap_package_payments_20260715
  SELECT pp.* FROM package_payments pp WHERE pp.id = ANY(v_freeze_pp)
     AND NOT EXISTS (SELECT 1 FROM _archive_f4571_pkg12_mismap_package_payments_20260715 a WHERE a.id=pp.id);
  SELECT count(*) INTO v_arch_pkg FROM _archive_f4571_pkg12_mismap_packages_20260715         WHERE id=v_freeze_pkg;
  SELECT count(*) INTO v_arch_pp  FROM _archive_f4571_pkg12_mismap_package_payments_20260715 WHERE id = ANY(v_freeze_pp);
  IF v_arch_pkg <> 1 OR v_arch_pp <> 4 THEN RAISE EXCEPTION 'DRYRUN archive 불완전 pkg=% pp=%.', v_arch_pkg, v_arch_pp; END IF;

  DELETE FROM package_payments WHERE id = ANY(v_refunds)  AND id <> ALL(ARRAY[v_keep_pp]);
  GET DIAGNOSTICS v_del = ROW_COUNT; v_del_pp := v_del;
  DELETE FROM package_payments WHERE id = ANY(v_payments) AND id <> ALL(ARRAY[v_keep_pp]);
  GET DIAGNOSTICS v_del = ROW_COUNT; v_del_pp := v_del_pp + v_del;
  IF v_del_pp <> 4 THEN RAISE EXCEPTION 'DRYRUN pp deleted=% (exp4).', v_del_pp; END IF;
  DELETE FROM packages WHERE id = v_freeze_pkg AND id <> ALL(ARRAY[v_keep_pkg]);
  GET DIAGNOSTICS v_del_pkg = ROW_COUNT;
  IF v_del_pkg <> 1 THEN RAISE EXCEPTION 'DRYRUN pkg deleted=% (exp1).', v_del_pkg; END IF;

  IF EXISTS (SELECT 1 FROM packages WHERE id=v_freeze_pkg)
     OR EXISTS (SELECT 1 FROM package_payments WHERE id = ANY(v_freeze_pp)) THEN
    RAISE EXCEPTION 'DRYRUN freeze 잔존.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM packages WHERE id=v_keep_pkg AND status='active')
     OR NOT EXISTS (SELECT 1 FROM package_payments WHERE id=v_keep_pp)
     OR NOT EXISTS (SELECT 1 FROM payments WHERE id=v_keep_pm AND status='active') THEN
    RAISE EXCEPTION 'DRYRUN KEEP 손상.'; END IF;

  RAISE NOTICE 'DRYRUN in-txn OK: archived 5 / deleted 5 / KEEP intact / net-loss 0.';
END $$;

-- (2) in-txn 효과 확인 (pre-rollback probe) — 기대: pkgA/ppA live=0, archive=1/4
SELECT 'in-txn' AS phase,
  (SELECT count(*) FROM packages         WHERE id='3bde69cb-0dfb-4517-a53d-e9889a7f29b3')                                    AS pkgA_live,
  (SELECT count(*) FROM package_payments WHERE id IN ('1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86','e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650')) AS ppA_live,
  (SELECT count(*) FROM _archive_f4571_pkg12_mismap_packages_20260715)         AS arch_pkg,
  (SELECT count(*) FROM _archive_f4571_pkg12_mismap_package_payments_20260715) AS arch_pp;

-- (2) sentinel exception-handler: 무영속 강제
DO $sentinel$
BEGIN
  RAISE EXCEPTION 'DRYRUN_SENTINEL_NO_PERSIST';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sentinel 포착(%) — 트랜잭션 ROLLBACK 진행(무영속).', SQLERRM;
END $sentinel$;

ROLLBACK;

-- ┌─────────────────────────────────────────────────────────────────────────────────┐
-- │ (3) POST-PROBE — ROLLBACK 후 무영속 introspection. 새 auto-commit statement.       │
-- │   기대: archive 테이블 2개 모두 NULL(부재), pkgA/ppA live 복귀(1/4).               │
-- │   arch_* 가 NULL 아니면 = COMMIT 누수 = sentinel-bypass = FAIL.                     │
-- └─────────────────────────────────────────────────────────────────────────────────┘
SELECT 'post-rollback' AS phase,
  to_regclass('public._archive_f4571_pkg12_mismap_packages_20260715')         AS arch_pkg_tbl,   -- expect NULL
  to_regclass('public._archive_f4571_pkg12_mismap_package_payments_20260715') AS arch_pp_tbl,    -- expect NULL
  (SELECT count(*) FROM packages         WHERE id='3bde69cb-0dfb-4517-a53d-e9889a7f29b3')                                    AS pkgA_live,  -- expect 1
  (SELECT count(*) FROM package_payments WHERE id IN ('1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86','e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650')) AS ppA_live;   -- expect 4

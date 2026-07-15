-- ROLLBACK — T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP Phase 2
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 목적: 파괴적 정정(pkg A + pp4 hard-DELETE)을 archive 테이블에서 live로 완전 복원 → pre-state 원복.
--       복원 후 archive 테이블 DROP (DDL까지 원복, ledger 정합).
-- 전제: 20260715230000_foot_f4571_pkg12_mismap_archive_cleanup.sql 이 apply되어 archive 5행 보존됨.
-- 복원 순서(FK 존중): packages(parent) → package_payments(child, self-FK는 payment→refund 순서로 정렬 INSERT).
-- 멱등: 이미 live에 존재하면 NOT EXISTS 가드로 skip.
-- author: dev-foot / 2026-07-15
-- ══════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_freeze_pkg uuid  := '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
  v_freeze_pp  uuid[] := ARRAY['1d865046-d740-468f-9025-7f66b7de62ea',
                               'c6fcbb7b-240a-4a85-97e4-18c84e113c86',
                               'e064d498-d35a-492c-9d68-18e3c888bff0',
                               '6f1a5f98-d335-439b-8d92-a378e1c24650']::uuid[];
  v_res_pkg int; v_res_pp int;
BEGIN
  -- archive 테이블 존재 확인 (없으면 복원 불가 = 이미 rollback됐거나 apply 안됨)
  IF to_regclass('public._archive_f4571_pkg12_mismap_packages_20260715') IS NULL
     OR to_regclass('public._archive_f4571_pkg12_mismap_package_payments_20260715') IS NULL THEN
    RAISE NOTICE 'archive 테이블 부재 — 복원할 스냅샷 없음. no-op.';
    RETURN;
  END IF;

  -- ── STEP 1. packages 복원 (parent 먼저) ──
  INSERT INTO packages
  SELECT a.* FROM _archive_f4571_pkg12_mismap_packages_20260715 a
   WHERE a.id = v_freeze_pkg
     AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.id = a.id);

  -- ── STEP 2. package_payments 복원 (payment → refund 순서: self-FK parent_payment_id 존중) ──
  INSERT INTO package_payments
  SELECT a.* FROM _archive_f4571_pkg12_mismap_package_payments_20260715 a
   WHERE a.id = ANY(v_freeze_pp)
     AND NOT EXISTS (SELECT 1 FROM package_payments pp WHERE pp.id = a.id)
   ORDER BY (CASE WHEN a.payment_type = 'refund' THEN 1 ELSE 0 END);

  -- ── STEP 3. 복원 검증 ──
  SELECT count(*) INTO v_res_pkg FROM packages         WHERE id = v_freeze_pkg;
  SELECT count(*) INTO v_res_pp  FROM package_payments WHERE id = ANY(v_freeze_pp);
  IF v_res_pkg <> 1 OR v_res_pp <> 4 THEN
    RAISE EXCEPTION 'ROLLBACK 복원 불완전 (pkg=% exp1, pp=% exp4).', v_res_pkg, v_res_pp;
  END IF;
  RAISE NOTICE 'rollback 완료: pkg A + pp4 live 복원 (5행). archive 테이블 DROP 진행.';
END $$;

-- ── STEP 4. archive 테이블 DROP (복원 후 DDL 원복 — ledger 정합) ──
DROP TABLE IF EXISTS _archive_f4571_pkg12_mismap_package_payments_20260715;
DROP TABLE IF EXISTS _archive_f4571_pkg12_mismap_packages_20260715;

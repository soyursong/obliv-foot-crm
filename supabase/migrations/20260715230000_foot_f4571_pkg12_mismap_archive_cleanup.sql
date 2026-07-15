-- T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 2 (파괴적 apply 마이그, archive-first)
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 대상: F-4571 [PHI-redacted] 2번 차트 — 담당자 수기실수로 오등록된 12회권 패키지(pkg A)
--       + 연동 package_payments 4행(결제2·환불2)의 archive-first 제거. 정상 8회권(pkg B)·
--       체험비 단건은 무접점 KEEP.
--
-- ⚠⚠ 이 마이그는 파괴적 원장 정정(package_payments 원장행 hard-DELETE)이다.
--    dev 단독 apply 금지. supervisor DB-GATE(gate3) + 대표 인지 GO 후에만 apply.
--    본 파일은 Phase 2 build 산출물 — 무영속 dry-run(.dryrun.sql)은 supervisor DB-GATE 소관.
--
-- 게이트 이력:
--   gate1 ✅ DA CONSULT 조건부 GO (DA-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP / MSG-…-52kn)
--             — archive-first 제거가 AC4 매출 split SSOT 불변·이중계상0·net-zero 원복(reversal 아님)
--               ·grain 준수로 계약 정합. C1~C7 집행조건 부과.
--   gate2 ✅ 김주연 총괄 confirm (2026-07-15 20:37 / 21:05) — Q2 decisive-fact "실환불 아님 =
--             오등록 정정용 장부 왕복" 명시 확인 + freeze셋 5건 눈확인. 삭제 정본 확정.
--   gate3 ⏳ supervisor DB-GATE(DDL-diff + migration_ledger_reconciliation + 무영속 dry-run) + 대표 인지.
--
-- 근거 포렌식(READ-ONLY, Phase1): _handoff/evidence/…phase1-forensic.md + scripts/…_dryrun.mjs (전부 PASS).
--   RC = 담당자 수기실수(one-off). transferred_from/to=NULL · package_sessions=0 · 재생성 흔적 0
--        → PKG-REGEN-CREDIT-ORPHAN-FKLINK 구조 gap 무관(MIG-2 FK-ADD N/A). 순수 데이터정정.
--
-- SOP: orphan_archive_fk_guard_sop(§1 archive-first/순소실0 · §2-0 카탈로그 기계열거 ·
--      §2-0-b confdeltype census · §2-2 freeze VALUES · §2-3 재검증 abort · §3 ADDITIVE→verify→DESTRUCTIVE)
--      + data_correction_backfill_sop(단일 count 기준 DELETE 금지 · 지문 교집합 freeze · 원장 무접점).
--
-- ── freeze셋 (삭제 대상 5건, 지문 교집합으로 확정 — 단일 count 아님) ──
--   pkg A            packages.id          = 3bde69cb-0dfb-4517-a53d-e9889a7f29b3  (12회권, refunded)
--   pp payment 1     package_payments.id  = 1d865046-d740-468f-9025-7f66b7de62ea  (10,000)
--   pp payment 2     package_payments.id  = c6fcbb7b-240a-4a85-97e4-18c84e113c86  (1,980,000)
--   pp refund 1      package_payments.id  = e064d498-d35a-492c-9d68-18e3c888bff0  (10,000, parent=1d865046)
--   pp refund 2      package_payments.id  = 6f1a5f98-d335-439b-8d92-a378e1c24650  (1,980,000, parent=c6fcbb7b)
-- ── KEEP셋 (절대 무접점) ──
--   pkg B            packages.id          = 9a553cbd-621b-435e-ae20-aabc035e363e  (8회권, active)
--   pp B             package_payments.id  = bc58d34e-0ac8-422c-8a83-c8b6000e0a6d  (1,980,000)
--   payment 단건     payments.id          = 01299d6c-d7e1-45bb-894b-ead27c80ac36  (10,000, 체험비, active)
--
-- DELETE 순서(C3, 내부 parent_payment_id[self-FK] 존중): refund 2 → payment 2 → pkg A.
-- 멱등: 재실행 시 archive는 NOT EXISTS 가드, DELETE는 STEP0 idempotency probe로 no-op.
-- rollback: 20260715230000_foot_f4571_pkg12_mismap_archive_cleanup.rollback.sql (archive→live 복원 + archive DROP).
-- change-class: archive 테이블 2개 CREATE(ADDITIVE net-new DDL, LIKE INCLUDING DEFAULTS) + payments/packages
--               원장행 hard-DELETE(DESTRUCTIVE-reversible). tracked 스키마(packages/package_payments/payments/FK) DDL 0.
-- author: dev-foot / 2026-07-15
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ═══ STEP A. ADDITIVE — archive 테이블 CREATE (net-new, 멱등) ═══
CREATE TABLE IF NOT EXISTS _archive_f4571_pkg12_mismap_packages_20260715
  (LIKE packages INCLUDING DEFAULTS);
COMMENT ON TABLE _archive_f4571_pkg12_mismap_packages_20260715 IS
  'T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP archive-first snapshot: 오등록 12회권 pkg A(F-4571 chart2). rollback source. 2026-07-15.';

CREATE TABLE IF NOT EXISTS _archive_f4571_pkg12_mismap_package_payments_20260715
  (LIKE package_payments INCLUDING DEFAULTS);
COMMENT ON TABLE _archive_f4571_pkg12_mismap_package_payments_20260715 IS
  'T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP archive-first snapshot: pkg A 연동 결제2·환불2. rollback source. 2026-07-15.';

-- ═══ STEP B. archive populate + 재검증 abort-guard + DESTRUCTIVE delete + postverify ═══
DO $$
DECLARE
  v_cust      uuid   := '99784454-1ee5-4c38-b677-7c085b3b19db';
  v_freeze_pkg uuid  := '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
  v_freeze_pp uuid[] := ARRAY['1d865046-d740-468f-9025-7f66b7de62ea',
                              'c6fcbb7b-240a-4a85-97e4-18c84e113c86',
                              'e064d498-d35a-492c-9d68-18e3c888bff0',
                              '6f1a5f98-d335-439b-8d92-a378e1c24650']::uuid[];
  v_refunds   uuid[] := ARRAY['e064d498-d35a-492c-9d68-18e3c888bff0',
                              '6f1a5f98-d335-439b-8d92-a378e1c24650']::uuid[];  -- 먼저 삭제 (child)
  v_payments  uuid[] := ARRAY['1d865046-d740-468f-9025-7f66b7de62ea',
                              'c6fcbb7b-240a-4a85-97e4-18c84e113c86']::uuid[];  -- 다음 삭제 (parent)
  v_keep_pkg  uuid   := '9a553cbd-621b-435e-ae20-aabc035e363e';
  v_keep_pp   uuid   := 'bc58d34e-0ac8-422c-8a83-c8b6000e0a6d';
  v_keep_pm   uuid   := '01299d6c-d7e1-45bb-894b-ead27c80ac36';

  v_live_pkg int; v_live_pp int; v_arch_pkg int; v_arch_pp int;
  v_fp int; v_net numeric; v_keep_ovl int; v_blast int;
  v_del int; v_del_pp int; v_del_pkg int;
BEGIN
  -- ── STEP 0. idempotency probe (재실행 안전) ──
  SELECT count(*) INTO v_live_pkg FROM packages         WHERE id = v_freeze_pkg;
  SELECT count(*) INTO v_live_pp  FROM package_payments WHERE id = ANY(v_freeze_pp);

  IF v_live_pkg = 0 AND v_live_pp = 0 THEN
    -- 이미 적용됨: archive 완전성 확인 후 no-op
    SELECT count(*) INTO v_arch_pkg FROM _archive_f4571_pkg12_mismap_packages_20260715         WHERE id = v_freeze_pkg;
    SELECT count(*) INTO v_arch_pp  FROM _archive_f4571_pkg12_mismap_package_payments_20260715 WHERE id = ANY(v_freeze_pp);
    IF v_arch_pkg <> 1 OR v_arch_pp <> 4 THEN
      RAISE EXCEPTION 'ABORT idempotency/audit: freeze 라이브 부재인데 archive 불완전 (pkg=% exp1, pp=% exp4). 수동 검토.', v_arch_pkg, v_arch_pp;
    END IF;
    RAISE NOTICE 'F-4571 pkg12 cleanup 이미 적용됨 (archived 5 / live 0). no-op.';
    RETURN;
  END IF;

  IF v_live_pkg <> 1 OR v_live_pp <> 4 THEN
    RAISE EXCEPTION 'ABORT drift/partial: live pkg=% (exp1), pp=% (exp4). freeze셋 불일치 — 수동 검토.', v_live_pkg, v_live_pp;
  END IF;

  -- ── STEP 1. 재검증 abort-guard (C4) — apply 직전 지문/net-zero/KEEP-disjoint/blast 재평가 ──
  -- (a) pkg A 지문 재검증
  SELECT count(*) INTO v_fp FROM packages
   WHERE id = v_freeze_pkg AND customer_id = v_cust
     AND status = 'refunded' AND package_type = '12회권'
     AND paid_amount = total_amount + 10000
     AND id NOT IN (SELECT DISTINCT package_id FROM package_sessions WHERE package_id IS NOT NULL)
     AND id NOT IN (SELECT DISTINCT package_id FROM check_ins        WHERE package_id IS NOT NULL);
  IF v_fp <> 1 THEN
    RAISE EXCEPTION 'ABORT: pkg A 지문 재검증 실패 (matched=% exp1). drift → 삭제 금지.', v_fp;
  END IF;

  -- (b) net-zero 재검증 (실환불 아님 = 오등록 원복)
  SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0)
       - COALESCE(SUM(CASE WHEN payment_type='refund'  THEN amount ELSE 0 END),0)
    INTO v_net FROM package_payments WHERE package_id = v_freeze_pkg;
  IF v_net <> 0 THEN
    RAISE EXCEPTION 'ABORT: pkg A net!=0 (net=%). within-day net-zero 아님 → 삭제 금지.', v_net;
  END IF;

  -- (c) KEEP ∩ freeze = 0 재확인 (이중가드)
  v_keep_ovl := (CASE WHEN v_keep_pkg = v_freeze_pkg THEN 1 ELSE 0 END)
              + (SELECT count(*) FROM unnest(v_freeze_pp) f WHERE f IN (v_keep_pp, v_keep_pm))::int;
  IF v_keep_ovl <> 0 THEN
    RAISE EXCEPTION 'ABORT: KEEP∩freeze overlap=% (exp0).', v_keep_ovl;
  END IF;

  -- (d) blast radius = 0 (C2/C3 pg_constraint 기계열거 결과 재검증: 자식 접점·외부 refund child)
  SELECT (SELECT count(*) FROM check_ins        WHERE package_id = v_freeze_pkg)
       + (SELECT count(*) FROM package_sessions WHERE package_id = v_freeze_pkg)
       + (SELECT count(*) FROM packages         WHERE transferred_from = v_freeze_pkg OR transferred_to = v_freeze_pkg)
       + (SELECT count(*) FROM claim_diagnoses  WHERE package_payment_id = ANY(v_freeze_pp))
       + (SELECT count(*) FROM package_payments WHERE parent_payment_id = ANY(v_freeze_pp) AND NOT (id = ANY(v_freeze_pp)))
    INTO v_blast;
  IF v_blast <> 0 THEN
    RAISE EXCEPTION 'ABORT: blast radius=% (exp0) — 외부 자식/전이 접점 발생. 삭제 금지.', v_blast;
  END IF;

  -- ── STEP 2. ADDITIVE — archive populate (전 컬럼 full-fidelity, 멱등 NOT EXISTS 가드) ──
  INSERT INTO _archive_f4571_pkg12_mismap_packages_20260715
  SELECT p.* FROM packages p
   WHERE p.id = v_freeze_pkg
     AND NOT EXISTS (SELECT 1 FROM _archive_f4571_pkg12_mismap_packages_20260715 a WHERE a.id = p.id);

  INSERT INTO _archive_f4571_pkg12_mismap_package_payments_20260715
  SELECT pp.* FROM package_payments pp
   WHERE pp.id = ANY(v_freeze_pp)
     AND NOT EXISTS (SELECT 1 FROM _archive_f4571_pkg12_mismap_package_payments_20260715 a WHERE a.id = pp.id);

  -- verify: archived 건수 = 제거예정 건수 (순소실0 담보) — DESTRUCTIVE 진입 전 게이트
  SELECT count(*) INTO v_arch_pkg FROM _archive_f4571_pkg12_mismap_packages_20260715         WHERE id = v_freeze_pkg;
  SELECT count(*) INTO v_arch_pp  FROM _archive_f4571_pkg12_mismap_package_payments_20260715 WHERE id = ANY(v_freeze_pp);
  IF v_arch_pkg <> 1 OR v_arch_pp <> 4 THEN
    RAISE EXCEPTION 'ABORT: archive 불완전 (pkg=% exp1, pp=% exp4) → DESTRUCTIVE 진입 금지.', v_arch_pkg, v_arch_pp;
  END IF;

  -- ── STEP 3. DESTRUCTIVE — refund → payment → pkg (keep 이중가드 id<>ALL, rowcount assert) ──
  DELETE FROM package_payments WHERE id = ANY(v_refunds)  AND id <> ALL(ARRAY[v_keep_pp]);
  GET DIAGNOSTICS v_del = ROW_COUNT;  v_del_pp := v_del;
  DELETE FROM package_payments WHERE id = ANY(v_payments) AND id <> ALL(ARRAY[v_keep_pp]);
  GET DIAGNOSTICS v_del = ROW_COUNT;  v_del_pp := v_del_pp + v_del;
  IF v_del_pp <> 4 THEN
    RAISE EXCEPTION 'ABORT: package_payments deleted=% (exp4).', v_del_pp;
  END IF;

  DELETE FROM packages WHERE id = v_freeze_pkg AND id <> ALL(ARRAY[v_keep_pkg]);
  GET DIAGNOSTICS v_del_pkg = ROW_COUNT;
  IF v_del_pkg <> 1 THEN
    RAISE EXCEPTION 'ABORT: packages deleted=% (exp1).', v_del_pkg;
  END IF;

  -- ── STEP 4. postverify — freeze 잔존 0 + KEEP 무손실(순소실0) ──
  IF EXISTS (SELECT 1 FROM packages WHERE id = v_freeze_pkg)
     OR EXISTS (SELECT 1 FROM package_payments WHERE id = ANY(v_freeze_pp)) THEN
    RAISE EXCEPTION 'ABORT: freeze 잔존 발견 post-delete.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM packages         WHERE id = v_keep_pkg AND status='active')
     OR NOT EXISTS (SELECT 1 FROM package_payments WHERE id = v_keep_pp)
     OR NOT EXISTS (SELECT 1 FROM payments        WHERE id = v_keep_pm AND status='active') THEN
    RAISE EXCEPTION 'ABORT: KEEP셋 손상 (순소실0 위반) — pkgB/ppB/체험비 단건 확인.';
  END IF;

  RAISE NOTICE 'F-4571 pkg12 mismap cleanup applied: archived 5 (pkg1+pp4) / deleted 5 / KEEP intact / net-loss 0.';
END $$;

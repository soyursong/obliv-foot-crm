-- DRY-RUN — T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B (무영속 검증, 재작성: child-first)
--   up.sql 의 파괴 로직을 그대로 계측하되 COMMIT 대신 ROLLBACK — 영속 0.
--   ⚠ 대상 행(prod 유입분)은 prod(supervisor DB-GATE)에서만 실재 — dev 에서는 freeze 0 로 abort 가 정상.
--   본 dry-run 은 _backup 러너 archive 를 흉내내는 TEMP 스냅샷을 txn 내부에 만들어 archive==delete·child-first·
--   순소실0 가드를 실제로 통과시키되, 전체를 ROLLBACK 으로 되돌린다(무영속). BEGIN..ROLLBACK 단일 txn.
BEGIN;

DO $$
DECLARE
  v_par_fp   int;
  v_child_n  int;
  v_paylink  int;
  v_impure   int;
  v_del_c    int;
  v_del_p    int;
  c_id1 constant uuid := 'f5ca6ec5-9372-466d-9b12-39200ce6e1d0';
  c_id2 constant uuid := '60667463-e09b-4a2d-b98b-0175a7c7014c';
BEGIN
  -- TEMP archive (러너 [1단] 흉내) — 지문으로 스냅샷. txn 종료(ROLLBACK)와 함께 소멸.
  CREATE TEMP TABLE _dry_raw ON COMMIT DROP AS
    SELECT * FROM public.redpay_raw_transactions
     WHERE approval_no='62071914' AND (raw_payload->'merchant'->>'id')='1777276003'
       AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  GET DIAGNOSTICS v_par_fp = ROW_COUNT;

  CREATE TEMP TABLE _dry_child ON COMMIT DROP AS
    SELECT * FROM public.payment_reconciliation_log
     WHERE raw_transaction_id IN (SELECT id FROM _dry_raw);
  GET DIAGNOSTICS v_child_n = ROW_COUNT;

  RAISE NOTICE '[DRY] parent 지문=% (기대=2) · child archive=% (판정시점 816, 실측 moving-target)', v_par_fp, v_child_n;

  SELECT count(*) INTO v_paylink FROM _dry_child WHERE payment_id IS NOT NULL;
  SELECT count(*) INTO v_impure  FROM _dry_child WHERE external_trxid IS DISTINCT FROM '0723C8124555';
  RAISE NOTICE '[DRY] 원장 무접점 payment_id NOT NULL=% (기대0) · scope 순도 타trxid=% (기대0)', v_paylink, v_impure;

  -- child-first DELETE (archive id 집합만)
  DELETE FROM public.payment_reconciliation_log WHERE id IN (SELECT id FROM _dry_child);
  GET DIAGNOSTICS v_del_c = ROW_COUNT;
  DELETE FROM public.redpay_raw_transactions
   WHERE id IN (c_id1, c_id2)
     AND approval_no='62071914' AND (raw_payload->'merchant'->>'id')='1777276003'
     AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  GET DIAGNOSTICS v_del_p = ROW_COUNT;

  RAISE NOTICE '[DRY] would-DELETE child=% (==archive % ?) parent=% (기대2). archive==delete → 순소실0. ROLLBACK 으로 무영속.',
    v_del_c, v_child_n, v_del_p;

  IF v_del_c <> v_child_n THEN RAISE NOTICE '[DRY] ⚠ child DELETE<>archive — 실행시 abort 대상'; END IF;
  IF v_del_p <> 2       THEN RAISE NOTICE '[DRY] ⚠ parent DELETE<>2 — 실행시 abort 대상'; END IF;
END $$;

ROLLBACK;

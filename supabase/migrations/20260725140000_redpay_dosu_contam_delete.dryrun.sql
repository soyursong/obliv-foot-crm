-- DRY-RUN — T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B (무영속 검증)
--   20260725140000_redpay_dosu_contam_delete.sql 의 DO 블록을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   freeze 카운트·FK-child 카운트·DELETE 건수 가드를 실제로 통과시키되 영속시키지 않는다.
--   ⚠ dev DB 에는 대상 행(prod 유입분)이 없으므로 freeze<>2 로 abort 됨이 정상 — 본 dry-run 은 prod
--     (supervisor DB-GATE)에서 실행해야 유의미. dev 실행 시 'freeze-set 0 행' abort = 대상 부재 확인.
BEGIN;

DO $$
DECLARE
  v_freeze_cnt   int;
  v_fk_reconlog  int := 0;
  v_fk_pending   int := 0;
  v_would_delete int;
BEGIN
  SELECT count(*) INTO v_freeze_cnt
  FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  RAISE NOTICE '[DRY-RUN] freeze-set 카운트=% (기대=2)', v_freeze_cnt;

  SELECT count(*) INTO v_fk_reconlog
  FROM public.payment_reconciliation_log l
  WHERE l.raw_transaction_id IN (
    SELECT id FROM public.redpay_raw_transactions
     WHERE approval_no = '62071914'
       AND (raw_payload->'merchant'->>'id') = '1777276003'
       AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe');

  IF to_regclass('public.foot_redpay_planb_pending_payment') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.foot_redpay_planb_pending_payment p
       WHERE p.matched_raw_txid IN (
         SELECT id FROM public.redpay_raw_transactions
          WHERE approval_no = '62071914'
            AND (raw_payload->'merchant'->>'id') = '1777276003'
            AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe')
    $q$ INTO v_fk_pending;
  END IF;
  RAISE NOTICE '[DRY-RUN] FK-child: reconciliation_log=% planb_pending=% (합산 0 이어야 de-minimis)', v_fk_reconlog, v_fk_pending;

  -- 실제 DELETE 를 실행해 ROW_COUNT 를 계측(트랜잭션은 최종 ROLLBACK 으로 무영속).
  DELETE FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  GET DIAGNOSTICS v_would_delete = ROW_COUNT;
  RAISE NOTICE '[DRY-RUN] would-DELETE 건수=% (기대=2). ROLLBACK 으로 무영속.', v_would_delete;
END $$;

ROLLBACK;

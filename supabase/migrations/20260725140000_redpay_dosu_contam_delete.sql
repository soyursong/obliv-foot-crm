-- T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B — 도수(비풋) 오염 2행 archive-first hard-DELETE
--
-- 배경: 부모 T-20260724-foot-REDPAY-DAY1-RECONCILE 포렌식이 redpay_raw_transactions 에 도수(body) leak
--   1건(approval_no 62071914, merchant_id 1777276003, 2행 = 승인 Y + 취소 N)을 확정. 근본벡터=redpay-reconcile
--   폴러의 filterToFootScope 가 merchant 도메인 경계 drop 부재(파트A 에서 봉인). 본 마이그는 기존 유입분 정정.
--
-- 판정(DA CONSULT-REPLY 2026-07-24, MSG-095536-wyh8):
--   Q2 = archive-first **hard-DELETE** (exclusion-tag REJECT). change-class=파괴적 원장정정.
--   de-minimis(2 test행·net~0·PHI無) + 최필경 field confirm(2026-07-24) → 별도 CEO게이트 불요,
--   실행 = supervisor DB-GATE(DATA-diff). ★단 FK-child 실자식>0 발견 시 de-minimis 무효 → 대표게이트 재개.
--
-- ⚠ DESTRUCTIVE DML (row 삭제). supervisor DB-GATE 통과 후에만 apply. dev 자가적용 안 함.
--   ADDITIVE carve-out(대표게이트 면제) 적용 금지. 파괴 실행=supervisor.
--
-- ── archive-first 2단 (Cross-CRM Orphan-Row Archive-First / data_correction SOP 준용) ──
--   [1단·apply 러너, off-git] 파괴 前 _backup 네임스페이스에 대상 2행 스냅샷 선적재
--       (러너: scripts/T-20260724-foot-REDPAY-DOSU-CONTAM-FIX_apply.mjs — daewoong/WS-C 선례 동일).
--       CREATE SCHEMA IF NOT EXISTS _backup;
--       CREATE TABLE _backup.redpay_dosu_contam_62071914_20260725 AS
--         SELECT * FROM public.redpay_raw_transactions
--          WHERE approval_no='62071914' AND (raw_payload->'merchant'->>'id')='1777276003'
--            AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
--       (DA §4 "archive tracked CREATE 금지" 준수 → 본 마이그는 archive CREATE 를 포함하지 않는다. DML only.)
--   [2단·본 마이그] freeze 재검증 + FK-child 실자식 재검증(>0 시 abort=CEO게이트 재개) → DELETE(ROW_COUNT 가드).
--   Rollback = 20260725140000_redpay_dosu_contam_delete.rollback.sql (_backup 에서 재INSERT 원복, 순소실 0).
--   Dry-run  = 20260725140000_redpay_dosu_contam_delete.dryrun.sql (BEGIN..ROLLBACK 무영속 COUNT 검증).
--
-- ── freeze-set = 버그경로 지문 교집합 (단일 count 기준 정정 금지, data_correction SOP) ──
--   지문: approval_no='62071914' ∧ 도수 merchant '1777276003' ∧ observe-marker 부재(_mode≠'observe').
--   대상 count <> 2 → abort(대상 드리프트/대상 외 혼입). DELETE <> 2 → abort(초과/미달 삭제).
--   원장(청구 원장) 무접점. 전 과정 단일 txn — 어느 단계든 RAISE 시 전체 롤백(무영속).
-- author: dev-foot / 2026-07-25

BEGIN;

DO $$
DECLARE
  v_freeze_cnt   int;
  v_fk_reconlog  int := 0;
  v_fk_pending   int := 0;
  v_deleted      int;
BEGIN
  -- ── freeze 재검증: 버그경로 지문 교집합 카운트 = 2 (승인 Y + 취소 N) ──
  SELECT count(*) INTO v_freeze_cnt
  FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';

  IF v_freeze_cnt <> 2 THEN
    RAISE EXCEPTION
      'DOSU-CONTAM-FIX ABORT: freeze-set % 행(기대=2, approval_no=62071914 ∧ merchant=1777276003 ∧ _mode≠observe) '
      '— 대상 드리프트/대상 외 혼입, 재-freeze·재확인 필요', v_freeze_cnt;
  END IF;

  -- ── FK-child 실자식 재검증 (AC4). 실자식>0 → de-minimis 무효 → hard-DELETE 금지 abort(대표게이트 재개). ──
  --    두 FK 모두 ON DELETE SET NULL 이라 DELETE 자체는 실패하지 않으나, 실자식 존재는 de-minimis 전제를
  --    falsify → 정책상 abort 하여 재-CONSULT/CEO게이트로 회부한다(silent nullify 금지).
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

  IF (v_fk_reconlog + v_fk_pending) <> 0 THEN
    RAISE EXCEPTION
      'DOSU-CONTAM-FIX ABORT: FK-child 실자식 존재 (payment_reconciliation_log=% foot_redpay_planb_pending_payment=%) '
      '— de-minimis 무효, hard-DELETE 금지 → 대표게이트 재개(재-CONSULT) 필요',
      v_fk_reconlog, v_fk_pending;
  END IF;
  RAISE NOTICE 'DOSU-CONTAM-FIX FK-child 계측: reconciliation_log=% planb_pending=% (합산 0 → de-minimis 유지)',
    v_fk_reconlog, v_fk_pending;

  -- ── archive-first 2단: (1단=apply 러너 _backup 스냅샷 완료 전제) → (2단) 파괴 실행 ──
  DELETE FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: 삭제 % 행(기대=2) — 초과/미달 삭제, 전체 롤백', v_deleted;
  END IF;
  RAISE NOTICE 'DOSU-CONTAM-FIX OK: 도수 오염 % 행 hard-DELETE 완료 (approval_no=62071914, merchant=1777276003, net~0).',
    v_deleted;
END $$;

COMMIT;

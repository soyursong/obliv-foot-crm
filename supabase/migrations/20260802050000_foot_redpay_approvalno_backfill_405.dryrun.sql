-- DRY-RUN (No-Persistence) — T-20260730-foot-REDPAY-APPROVALNO-BACKFILL-405
--   20260802050000_foot_redpay_approvalno_backfill_405.sql 의 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   ambiguous 분리 카운트·freeze count·would-UPDATE ROW_COUNT·rows-affected assert 를 실제로 통과시키되 영속시키지 않는다.
--   AC-0 field-soak GO 前 허용 단계(freeze 설계·SQL 리뷰·dry-run)의 dry-run 아티팩트.
--
--   ⚠ dev DB 에는 대상 405건(prod 유입분)이 없으므로 freeze=0(benign no-op) 으로 통과됨이 정상 —
--     본 dry-run 은 prod(supervisor DB-gate)에서 실행해야 유의미. dev 실행 시 'freeze 0건' = 대상 부재 확인.
--   ⚠ 무영속: _backup 적재·TEMP·UPDATE 전부 ROLLBACK 으로 되돌림(migration_dryrun_no_persistence 준수, 데이터 무변).
-- =====================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TEMP TABLE _bf_ambiguous_dry ON COMMIT DROP AS
SELECT r.matched_payment_id AS payment_id,
       count(DISTINCT r.approval_no) AS distinct_approval_cnt
FROM public.redpay_raw_transactions r
JOIN public.payments p ON p.id = r.matched_payment_id
WHERE r.matched_payment_id IS NOT NULL
  AND r.approval_no IS NOT NULL
  AND p.external_approval_no IS NULL
GROUP BY r.matched_payment_id
HAVING count(DISTINCT r.approval_no) >= 2;

DO $$
DECLARE
  v_ambiguous_cnt int;
  v_freeze_cnt    int;
  v_updated       int;
BEGIN
  SELECT count(*) INTO v_ambiguous_cnt FROM _bf_ambiguous_dry;
  RAISE NOTICE '[DRY-RUN] ambiguous(1:N distinct approval_no) 분리=% 건 → manual 큐(기대: guess 대상만)', v_ambiguous_cnt;

  CREATE TEMP TABLE _bf_target_dry ON COMMIT DROP AS
  SELECT p.id AS payment_id,
         (SELECT max(r.approval_no)
            FROM public.redpay_raw_transactions r
           WHERE r.matched_payment_id = p.id
             AND r.approval_no IS NOT NULL) AS approval_no
  FROM public.payments p
  WHERE p.external_approval_no IS NULL
    AND EXISTS (
      SELECT 1 FROM public.redpay_raw_transactions r
       WHERE r.matched_payment_id = p.id
         AND r.approval_no IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM _bf_ambiguous_dry a WHERE a.payment_id = p.id);

  SELECT count(*) INTO v_freeze_cnt FROM _bf_target_dry;
  RAISE NOTICE '[DRY-RUN] freeze-set(대상 payment) 카운트=% (prod 기대 ≈405; dev=0 정상=대상 부재)', v_freeze_cnt;

  IF EXISTS (SELECT 1 FROM _bf_target_dry WHERE approval_no IS NULL) THEN
    RAISE EXCEPTION '[DRY-RUN] ABORT: freeze-set 에 approval_no NULL 혼입 — 대상 드리프트';
  END IF;

  -- 실제 UPDATE 를 실행해 ROW_COUNT 계측(트랜잭션은 최종 ROLLBACK 으로 무영속).
  UPDATE public.payments p
  SET external_approval_no = t.approval_no
  FROM _bf_target_dry t
  WHERE p.id = t.payment_id
    AND p.external_approval_no IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_freeze_cnt THEN
    RAISE EXCEPTION '[DRY-RUN] ABORT: would-UPDATE % ≠ freeze % — target-set drift', v_updated, v_freeze_cnt;
  END IF;

  RAISE NOTICE '[DRY-RUN] would-UPDATE=% (=freeze). ambiguous=% 제외. rows-affected assert PASS. ROLLBACK 으로 무영속.',
    v_updated, v_ambiguous_cnt;
END $$;

ROLLBACK;

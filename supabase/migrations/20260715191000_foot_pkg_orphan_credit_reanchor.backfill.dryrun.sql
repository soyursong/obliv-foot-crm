-- DRY-RUN (No-Persistence): T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR-BACKFILL (data lane)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · apply.sql 의 txn-control(BEGIN/COMMIT) STRIP → 아래는 단일 BEGIN..ROLLBACK 로 감싸 무영속.
--     (apply 의 COMMIT 를 그대로 실행하면 append 가 sentinel 이전 영속 → evidence divergence hazard.)
--   · guard(freeze셋 재검증) + INSERT(append) + post-assert 를 그대로 실행하되 ROLLBACK 로 무영속.
--   · 사후 무영속(post-probe)은 runner 별 트랜잭션에서 batch memo 행 부재 재확인.
-- ⚠ supervisor 는 apply.sql 과 동일한 freeze VALUES 를 STEP 1 에 붙여 dry-run → append 예상건수/합 확인 →
--   data-diff 대조 → GO 후 apply.sql 실행.
BEGIN;

CREATE TEMP TABLE _orphan_freeze (
  orphan_package_id  UUID NOT NULL,
  customer_id        UUID NOT NULL,
  clinic_id          UUID,
  reanchor_target_pkg UUID NOT NULL,
  credit_won         INTEGER NOT NULL
) ON COMMIT DROP;

-- >>> SUPERVISOR: apply.sql 과 동일한 auto_candidate freeze VALUES 붙여넣기 <<<
-- INSERT INTO _orphan_freeze VALUES (...);

-- ---- guard (apply STEP 2 와 동일) ----
DO $guard$
DECLARE v_total INTEGER; v_bad INTEGER; v_gp INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM _orphan_freeze;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'DRYRUN-ABORT: freeze셋 비어있음(template 미치환) — fail-closed';
  END IF;
  SELECT COUNT(*) INTO v_gp FROM _orphan_freeze f
   WHERE f.reanchor_target_pkg::text LIKE '3f4d3ec6%' OR f.reanchor_target_pkg::text LIKE '5ed60da7%';
  IF v_gp > 0 THEN RAISE EXCEPTION 'DRYRUN-ABORT: 조부모 Part1 활성 pkg 포함 % 건(이중정정)', v_gp; END IF;
  SELECT COUNT(*) INTO v_bad
  FROM _orphan_freeze f
  WHERE NOT EXISTS (
    SELECT 1 FROM public.packages o
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                               WHEN pp.payment_type='refund'  THEN -pp.amount END),0) AS net_pp
      FROM public.package_payments pp WHERE pp.package_id = o.id) agg ON true
    WHERE o.id = f.orphan_package_id AND o.status IN ('cancelled','refunded')
      AND o.superseded_by IS NULL
      AND GREATEST(agg.net_pp, COALESCE(o.paid_amount,0)) = f.credit_won)
  OR NOT EXISTS (
    SELECT 1 FROM public.packages a
    WHERE a.id = f.reanchor_target_pkg AND a.status='active' AND a.customer_id = f.customer_id)
  OR EXISTS (
    SELECT 1 FROM public.package_credit_ledger l WHERE l.reanchored_from = f.orphan_package_id);
  IF v_bad > 0 THEN RAISE EXCEPTION 'DRYRUN-ABORT: freeze 재검증 불일치 % 건', v_bad; END IF;
  RAISE NOTICE 'DRYRUN-GUARD-OK: freeze % 건 재검증 통과', v_total;
END $guard$;

-- ---- append (apply STEP 3 와 동일) ----
INSERT INTO public.package_credit_ledger
  (clinic_id, customer_id, account_type, account_id, tx_type, amount,
   source_payment_id, reanchored_from, memo, created_by, created_at)
SELECT f.clinic_id, f.customer_id, 'package', f.reanchor_target_pkg, 'charge', f.credit_won,
   NULL, f.orphan_package_id,
   '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR] reanchor credit from orphan pkg '
     || f.orphan_package_id::text || ' -> active pkg ' || f.reanchor_target_pkg::text,
   NULL, now()
FROM _orphan_freeze f;

-- ---- dry-run report (예상 append 건수/합) ----
DO $rep$
DECLARE v_cnt INTEGER; v_sum BIGINT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_cnt, v_sum
  FROM public.package_credit_ledger
  WHERE memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%';
  RAISE NOTICE 'DRYRUN-OK: append 예상 % 건 / 합 % 원 (무영속 — 곧 ROLLBACK)', v_cnt, v_sum;
END $rep$;

ROLLBACK;  -- 무영속

-- ---- post-probe (runner 별 트랜잭션 — 무영속 재확인) ----
-- SELECT COUNT(*) FROM public.package_credit_ledger
--   WHERE memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%';   -- 0 기대

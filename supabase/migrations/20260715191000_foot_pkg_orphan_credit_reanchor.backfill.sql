-- ============================================================
-- ORPHAN CREDIT RE-ANCHOR BACKFILL — APPLY (data lane, append-only)
-- T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR-BACKFILL
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-07-18
-- dry-run(무영속): 20260715191000_foot_pkg_orphan_credit_reanchor.backfill.dryrun.sql
-- rollback:        20260715191000_foot_pkg_orphan_credit_reanchor.backfill.rollback.sql
-- freeze/report:   20260715190000_foot_pkg_orphan_credit_freeze.report.sql
-- ============================================================
-- 무엇: 과거 재생성으로 옛 pkg 에 고아로 남은 credit 을 현 활성 pkg 로 re-anchor.
--       re-anchor = package_credit_ledger 로의 charge tx APPEND (원장 무접점 · blanket UPDATE 아님).
--       payments / package_payments / packages.paid_amount 는 손대지 않는다(순수 append).
--
-- ★ 안전봉투 (data_correction_backfill_sop + orphan archive-first guard):
--   1) 대상 = report.sql (B) 의 probe_verdict='auto_candidate' 건만. supervisor 가 freeze VALUES 로 고정.
--   2) 실행 직전 freeze셋 재검증(§Part1.2): 고아 pkg 상태/credit, 활성 target 상태, 미(未)re-anchor 를
--      건별 재확인 → 하나라도 불일치면 RAISE → 전체 abort(부분적용 없음, 단일 txn).
--   3) blanket UPDATE 0 — INSERT(append) 만. 건별 VALUES 로 명시(단일 count 기준 대량정정 아님).
--   4) idempotent — 이미 re-anchor 된 고아(reanchored_from 존재)는 재검증에서 걸러 abort/skip.
--   5) batch 태그 memo 로 rollback 가역성 확보.
--
-- ⚠ dev-foot 는 prod 에 직접 적용하지 않는다. supervisor data-diff 게이트(dry-run 대조 → GO) 후에만 apply.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 0. batch marker (rollback 태그 · 판정근거 memo 접두)
-- ------------------------------------------------------------
-- memo 는 '[BACKFILL:T-20260715-...-REANCHOR] reanchor from <orphan_pkg>' 형태로 남긴다.
-- rollback 은 이 접두로 DELETE. (마이그는 postgres 권한 → append-only RLS 우회 정상.)

-- ------------------------------------------------------------
-- STEP 1. FREEZE SET (supervisor 가 report.sql (B) auto_candidate 스냅샷을 아래에 고정)
--   각 행 = (orphan_package_id, customer_id, clinic_id, reanchor_target_pkg, credit_won)
--   ⚠ auto_candidate 만. hold_*/skip_* 는 넣지 말 것(폴백/ idempotency).
--   ⚠ 빈 셋이면 STEP 2 가드가 fail-closed(RAISE) → 잘못된 no-op apply 방지.
-- ------------------------------------------------------------
CREATE TEMP TABLE _orphan_freeze (
  orphan_package_id  UUID NOT NULL,
  customer_id        UUID NOT NULL,
  clinic_id          UUID,
  reanchor_target_pkg UUID NOT NULL,
  credit_won         INTEGER NOT NULL
) ON COMMIT DROP;

-- >>> SUPERVISOR: 아래 VALUES 를 report.sql (B) auto_candidate 스냅샷으로 교체 <<<
-- INSERT INTO _orphan_freeze (orphan_package_id, customer_id, clinic_id, reanchor_target_pkg, credit_won) VALUES
--   ('<orphan-uuid>', '<customer-uuid>', '<clinic-uuid>', '<active-pkg-uuid>', 12345),
--   ...
-- ;
-- (템플릿 상태로 실행하면 STEP 2 가 "빈 freeze셋" 으로 abort — 의도된 fail-closed.)

-- ------------------------------------------------------------
-- STEP 2. freeze셋 재검증 abort-guard (실행 직전 drift 검사)
--   불일치 1건이라도 → RAISE → 전체 롤백. 부분 apply 없음.
-- ------------------------------------------------------------
DO $guard$
DECLARE
  v_total   INTEGER;
  v_bad     INTEGER;
  v_gp      INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM _orphan_freeze;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'ABORT: freeze셋 비어있음(template 미치환?) — no-op apply 방지 fail-closed';
  END IF;

  -- (a) 조부모 Part1 freeze 2건(이미 정정된 활성 pkg)로의 re-anchor 금지 — 이중정정 방지(AC1)
  SELECT COUNT(*) INTO v_gp FROM _orphan_freeze f
   WHERE f.reanchor_target_pkg::text LIKE '3f4d3ec6%'
      OR f.reanchor_target_pkg::text LIKE '5ed60da7%';
  IF v_gp > 0 THEN
    RAISE EXCEPTION 'ABORT: freeze셋에 조부모 Part1 정정 활성 pkg 포함(% 건) — 이중정정 위험', v_gp;
  END IF;

  -- (b) 건별 재검증: 고아 pkg 실재/폐기상태, credit 동액, 활성 target, 미 re-anchor
  SELECT COUNT(*) INTO v_bad
  FROM _orphan_freeze f
  WHERE NOT EXISTS (
    -- 고아 원본: 여전히 cancelled/refunded + credit 동액 + superseded_by NULL
    SELECT 1
    FROM public.packages o
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                               WHEN pp.payment_type='refund'  THEN -pp.amount END),0) AS net_pp
      FROM public.package_payments pp WHERE pp.package_id = o.id
    ) agg ON true
    WHERE o.id = f.orphan_package_id
      AND o.status IN ('cancelled','refunded')
      AND o.superseded_by IS NULL
      AND GREATEST(agg.net_pp, COALESCE(o.paid_amount,0)) = f.credit_won
  )
  OR NOT EXISTS (
    -- 활성 target: 여전히 active + 동일 고객
    SELECT 1 FROM public.packages a
    WHERE a.id = f.reanchor_target_pkg
      AND a.status = 'active'
      AND a.customer_id = f.customer_id
  )
  OR EXISTS (
    -- 이미 re-anchor 된 고아면 중복 append 금지
    SELECT 1 FROM public.package_credit_ledger l
    WHERE l.reanchored_from = f.orphan_package_id
  );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: freeze셋 재검증 불일치 % 건(drift/이미정정/target비활성) — 전체 롤백', v_bad;
  END IF;

  RAISE NOTICE 'GUARD-OK: freeze % 건 재검증 통과 — re-anchor append 진행', v_total;
END
$guard$;

-- ------------------------------------------------------------
-- STEP 3. re-anchor = ledger charge tx APPEND (건별, blanket UPDATE 아님)
--   account_type='package', account_id=현 활성 pkg, amount=+credit_won(charge),
--   reanchored_from=고아 원본 pkg(계보), source_payment_id=NULL(과거 credit 재적재),
--   memo=batch 태그(rollback 근거) + 고아 계보.
-- ------------------------------------------------------------
INSERT INTO public.package_credit_ledger
  (clinic_id, customer_id, account_type, account_id, tx_type, amount,
   source_payment_id, reanchored_from, memo, created_by, created_at)
SELECT
  f.clinic_id,
  f.customer_id,
  'package',
  f.reanchor_target_pkg,
  'charge',
  f.credit_won,
  NULL,
  f.orphan_package_id,
  '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR] reanchor credit from orphan pkg '
    || f.orphan_package_id::text || ' -> active pkg ' || f.reanchor_target_pkg::text,
  NULL,
  now()
FROM _orphan_freeze f;

-- ------------------------------------------------------------
-- STEP 4. 사후 불변식 assertion (커밋 전 self-test)
--   · append 행수 == freeze 행수
--   · 각 활성 target 의 배치 ledger 합 == freeze credit_won
-- ------------------------------------------------------------
DO $post$
DECLARE
  v_freeze  INTEGER;
  v_appended INTEGER;
  v_mismatch INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_freeze FROM _orphan_freeze;

  SELECT COUNT(*) INTO v_appended
  FROM public.package_credit_ledger l
  JOIN _orphan_freeze f ON f.orphan_package_id = l.reanchored_from
  WHERE l.memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%';

  IF v_appended <> v_freeze THEN
    RAISE EXCEPTION 'POST-FAIL: append 행수 % <> freeze 행수 %', v_appended, v_freeze;
  END IF;

  SELECT COUNT(*) INTO v_mismatch
  FROM _orphan_freeze f
  JOIN public.package_credit_ledger l
    ON l.reanchored_from = f.orphan_package_id
   AND l.memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%'
  WHERE l.amount <> f.credit_won OR l.account_id <> f.reanchor_target_pkg;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'POST-FAIL: 금액/귀속 불일치 % 건', v_mismatch;
  END IF;

  RAISE NOTICE 'POST-OK: % 건 re-anchor append 정합(원장 무접점, blanket UPDATE 0)', v_appended;
END
$post$;

COMMIT;

-- ============================================================
-- POST-DEPLOY (supervisor data-diff 게이트)
-- ------------------------------------------------------------
-- [ ] 1. append 건수 == freeze auto_candidate 건수(dry-run count 와 동일)
-- [ ] 2. 각 활성 target: SELECT public.package_credit_balance(target) == credit_won(재적재분)
-- [ ] 3. payments / package_payments / packages.paid_amount 무변경(net-zero, 원장 무접점)
-- [ ] 4. UPDATE/DELETE 0 — append(INSERT) 만(blanket UPDATE 0, AC2)
-- [ ] 5. 폴백: hold_* 건은 본 batch 미포함 → 현장(김주연 총괄) 확인 큐 별도 처리(AC4, 순소실 0)
-- ============================================================

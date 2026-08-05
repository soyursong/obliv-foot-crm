-- ══════════════════════════════════════════════════════════════════════════════
-- T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE — APPLY (DESTRUCTIVE-but-reversible)
-- ══════════════════════════════════════════════════════════════════════════════
-- 고객: 남정현 (9487b2f7-0769-4038-a373-84182f6acc11 / F-5263) @ 풋센터 74967aea
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_payment_dup_entangled_set_reconcile_20260804.md
-- CONSULT-REPLY: MSG-20260804-174812-5shd (data-architect → dev-foot)
-- freeze baseline: memory/_handoff/evidence/T-20260804-foot-PAYMENT-DUP-DELETE-NAMJH_phaseA_snapshot.json (DO-NOT-MUTATE)
--
-- ⚠⚠⚠ 실행 게이트 (AND·전항 의무, DA §6) — 미충족 시 실행 금지 ⚠⚠⚠
--   (1) 박민지 per-row comp-gate: 각 행 disposition confirm + 구성적 end-state confirm
--       + fa509f09 팬텀 / 73e604cf 중복 모호 해소.  under-correct ≫ over → confirm 불가 행 HOLD.
--   (2) supervisor dry-run: rows-affected==freeze count exact / archive read-back 순소실0
--       / apply-직전 라이브 재-freeze drift ABORT.
--   (3) CEO 파괴게이트 = 면제(§3.1, archive-first 가역 + 진실 보존). 단 7/31 −1,408,800 restatement
--       material → 원장/대표 magnitude awareness(non-blocking 통지).
--   ★ 이 스크립트는 dev-foot 가 직접 prod 에 apply 하지 않는다. supervisor 가 게이트 충족 후 실행.
--
-- 기전(DA §4):
--   • payments(status 有)          → soft-delete (status active→deleted + deleted_at/reason). 가역.
--   • package_payments(status 부재)  → Orphan-Row Archive-First: before-image archive → DELETE. 가역(archive 복원).
--   • packages.paid_amount 캐시      → 명시적 recompute (net active package_payments 기준).
--
-- 축(basis-parity, dev-foot 확정 2026-08-04):
--   closing/outbox = created_at KST(daily_closings 컬럼 동축, T-20260804 HERALD-PAYLOAD-RECONCILE census 확정).
--   stats RPC = accounting_date(별축·이 정정과 무관). soft-delete 행은 closing 윈도우 .neq('status','deleted') 로
--   자동 제외 + payload emit-time recompute(v_total) → 정합 후 emit(correct-then-emit)이면 payload 자동 정정.
--
-- 오라클(구성적, DA §5) — grand-total 일치는 함정(§2). 아래 assertion 으로 강제.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  -- ── 대상 고객/패키지 ──────────────────────────────────────────────────────
  v_cust        uuid := '9487b2f7-0769-4038-a373-84182f6acc11';
  v_clinic      uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_pkg         uuid := 'cd91e487-8ee9-4701-b40c-ab1cef60a2cd';

  -- ── 73e604cf 처리 토글 (박민지 per-row confirm 후 supervisor 가 세팅) ─────────
  --   FALSE(기본·안전) = HOLD(무접촉, 정상 단건 가정 → single net 17,600).
  --   TRUE            = 중복 확정 → soft-delete 포함 → single net 8,800.
  v_include_73e604cf boolean := FALSE;   -- ★박민지 confirm 후에만 TRUE

  -- ── freeze-set (명시 PK VALUES, DA §6-1) ─────────────────────────────────
  --   payments soft-delete 대상 (Tier A 확정 4행 중 73e604cf 는 토글):
  v_pay_target1 uuid := '46821230-d76e-49ab-b5c3-a9e69a5a5255'; -- +8,800 7/30 단건 중복
  v_pay_undo    uuid := 'e0dc5d36-6530-44ec-b848-10b1b590b2d2'; -- −8,800 target#1 undo(linked)
  v_pay_phantom uuid := 'fa509f09-48bb-4859-a470-589e15df1868'; -- +1,400,000 팬텀 단건(pkg=NULL)
  v_pay_dup2    uuid := '73e604cf-9b78-4f86-b5c9-a09f204cf086'; -- +8,800 중복 의심(토글)
  --   package_payments archive+delete 대상 (net-neutral 쌍):
  v_pkg_target2 uuid := '38b5c660-787a-4beb-9da6-a2bc32f12f65'; -- +1,400,000 완납 패키지 중복
  v_pkg_undo    uuid := '5182ecea-d124-419b-94e9-742e04d9b944'; -- −1,400,000 target#2 undo

  v_delreason   text := 'T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE 남정현(F-5263) 중복결제 얽힌집합 정합(DA SSOT)';

  -- ── 작업 변수 ────────────────────────────────────────────────────────────
  v_expected_pay_rows int;
  v_pay_affected      int;
  v_pkg_archived      int;
  v_pkg_deleted       int;
  v_single_net        numeric;
  v_pkg_net           numeric;
  v_paid_new          numeric;
  v_pkg_total         numeric;
  v_orphan_refunds    int;
  v_phantom_singles   int;
  v_single_expected   numeric;
  r                   record;
BEGIN
  -- ════════════════════════════════════════════════════════════════════════
  -- 0) FREEZE RE-VERIFY (apply-직전 drift ABORT, DA §6-3) — 어떤 mutation 前
  --    freeze snapshot 값과 현재 값 불일치 시 즉시 abort(현장 활발 편집 drift 위험 高).
  -- ════════════════════════════════════════════════════════════════════════
  FOR r IN
    SELECT * FROM (VALUES
      (v_pay_target1, 'payment'::text,   8800::numeric, 'active'::text, NULL::uuid),
      (v_pay_undo,    'refund',          8800,          'active',       v_pay_target1),
      (v_pay_phantom, 'payment',         1400000,       'active',       NULL::uuid),
      (v_pay_dup2,    'payment',         8800,          'active',       NULL::uuid)
    ) AS f(id, ptype, amt, st, link)
  LOOP
    PERFORM 1 FROM public.payments p
      WHERE p.id = r.id
        AND p.payment_type = r.ptype
        AND p.amount = r.amt
        AND p.status = r.st
        AND p.customer_id = v_cust
        AND p.package_id IS NULL
        AND COALESCE(p.linked_payment_id::text,'∅') = COALESCE(r.link::text,'∅');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DRIFT-ABORT payments % : freeze snapshot 불일치(현장 편집 drift). 재-CONSULT.', r.id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      (v_pkg_target2, 'payment'::text, 1400000::numeric),
      (v_pkg_undo,    'refund',        1400000)
    ) AS f(id, ptype, amt)
  LOOP
    PERFORM 1 FROM public.package_payments pp
      WHERE pp.id = r.id
        AND pp.payment_type = r.ptype
        AND pp.amount = r.amt
        AND pp.customer_id = v_cust
        AND pp.package_id = v_pkg;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DRIFT-ABORT package_payments % : freeze snapshot 불일치. 재-CONSULT.', r.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'freeze re-verify PASS (drift 0)';

  -- ════════════════════════════════════════════════════════════════════════
  -- 1) ARCHIVE-FIRST before-image (DA §6-1) — 접촉 전 전량 박제(가역 감사)
  -- ════════════════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS public._archive_paydup_namjh_20260804
    (LIKE public.payments INCLUDING DEFAULTS);
  ALTER TABLE public._archive_paydup_namjh_20260804
    ADD COLUMN IF NOT EXISTS _archived_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS _ticket text,
    ADD COLUMN IF NOT EXISTS _disposition text;

  CREATE TABLE IF NOT EXISTS public._archive_pkgpaydup_namjh_20260804
    (LIKE public.package_payments INCLUDING DEFAULTS);
  ALTER TABLE public._archive_pkgpaydup_namjh_20260804
    ADD COLUMN IF NOT EXISTS _archived_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS _ticket text,
    ADD COLUMN IF NOT EXISTS _disposition text;

  -- payments before-image (soft-delete 대상 = 가역이나 belt+suspenders 로 before-image 도 박제)
  INSERT INTO public._archive_paydup_namjh_20260804
  SELECT p.*, now(), 'T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE', 'soft-delete'
  FROM public.payments p
  WHERE p.id IN (v_pay_target1, v_pay_undo, v_pay_phantom)
     OR (v_include_73e604cf AND p.id = v_pay_dup2)
  ON CONFLICT DO NOTHING;

  -- package_payments before-image (DELETE 대상 = archive 가 유일 복원 소스, 필수)
  INSERT INTO public._archive_pkgpaydup_namjh_20260804
  SELECT pp.*, now(), 'T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE', 'archive-first-delete'
  FROM public.package_payments pp
  WHERE pp.id IN (v_pkg_target2, v_pkg_undo)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_pkg_archived = ROW_COUNT;
  IF v_pkg_archived <> 2 THEN
    RAISE EXCEPTION 'ARCHIVE-ABORT package_payments before-image 행수 % (기대 2). 순소실 위험.', v_pkg_archived;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 2) payments SOFT-DELETE (status active→deleted, 가역·감사보존)
  --    linked chain: target#1 soft-delete 시 그 환불 e0dc5d36 동반(orphan 환불 방지).
  -- ════════════════════════════════════════════════════════════════════════
  v_expected_pay_rows := CASE WHEN v_include_73e604cf THEN 4 ELSE 3 END;

  UPDATE public.payments
     SET status = 'deleted',
         deleted_at = now(),
         delete_reason = v_delreason
   WHERE customer_id = v_cust
     AND status = 'active'
     AND ( id IN (v_pay_target1, v_pay_undo, v_pay_phantom)
           OR (v_include_73e604cf AND id = v_pay_dup2) );
  GET DIAGNOSTICS v_pay_affected = ROW_COUNT;
  IF v_pay_affected <> v_expected_pay_rows THEN
    RAISE EXCEPTION 'ROWCOUNT-ABORT payments soft-delete 행수 % (기대 %). freeze 불일치.',
      v_pay_affected, v_expected_pay_rows;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 3) package_payments ARCHIVE-FIRST DELETE (net-neutral 쌍)
  -- ════════════════════════════════════════════════════════════════════════
  DELETE FROM public.package_payments
   WHERE id IN (v_pkg_target2, v_pkg_undo)
     AND customer_id = v_cust
     AND package_id = v_pkg;
  GET DIAGNOSTICS v_pkg_deleted = ROW_COUNT;
  IF v_pkg_deleted <> 2 THEN
    RAISE EXCEPTION 'ROWCOUNT-ABORT package_payments delete 행수 % (기대 2).', v_pkg_deleted;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 4) packages.paid_amount 캐시 RECOMPUTE (net 잔존 active package_payments)
  -- ════════════════════════════════════════════════════════════════════════
  SELECT COALESCE(SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END),0)
    INTO v_paid_new
    FROM public.package_payments pp
   WHERE pp.package_id = v_pkg;

  UPDATE public.packages SET paid_amount = v_paid_new, updated_at = now()
   WHERE id = v_pkg;

  -- ════════════════════════════════════════════════════════════════════════
  -- 5) 구성적 ORACLE 검증 (DA §5) — 실패 시 RAISE → 트랜잭션 abort(rollback)
  -- ════════════════════════════════════════════════════════════════════════
  -- (a) package net = 2,400,000 / paid_amount 캐시 = 2,400,000 / balance(total−paid)=0
  SELECT COALESCE(SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END),0)
    INTO v_pkg_net FROM public.package_payments pp WHERE pp.package_id = v_pkg;
  SELECT total_amount, paid_amount INTO v_pkg_total, v_paid_new
    FROM public.packages WHERE id = v_pkg;

  IF v_pkg_net <> 2400000 THEN
    RAISE EXCEPTION 'ORACLE-FAIL package net % (기대 2,400,000)', v_pkg_net;
  END IF;
  IF v_paid_new <> 2400000 THEN
    RAISE EXCEPTION 'ORACLE-FAIL paid_amount 캐시 % (기대 2,400,000)', v_paid_new;
  END IF;
  IF (v_pkg_total - v_paid_new) <> 0 THEN
    RAISE EXCEPTION 'ORACLE-FAIL package balance % (기대 0)', (v_pkg_total - v_paid_new);
  END IF;

  -- (b) single net(status='active', pkg=NULL) = 8,800(73 제거) 또는 17,600(73 HOLD)
  v_single_expected := CASE WHEN v_include_73e604cf THEN 8800 ELSE 17600 END;
  SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)
    INTO v_single_net
    FROM public.payments p
   WHERE p.customer_id = v_cust AND p.status = 'active' AND p.package_id IS NULL;
  IF v_single_net <> v_single_expected THEN
    RAISE EXCEPTION 'ORACLE-FAIL single net % (기대 % / include_73=%)',
      v_single_net, v_single_expected, v_include_73e604cf;
  END IF;

  -- (c) orphan 환불 0: deleted payment 를 가리키는 활성 환불 부재
  SELECT count(*) INTO v_orphan_refunds
    FROM public.payments r
    JOIN public.payments t ON t.id = r.linked_payment_id
   WHERE r.customer_id = v_cust AND r.status = 'active'
     AND r.payment_type = 'refund' AND t.status = 'deleted';
  IF v_orphan_refunds <> 0 THEN
    RAISE EXCEPTION 'ORACLE-FAIL orphan 환불 % (기대 0)', v_orphan_refunds;
  END IF;

  -- (d) 팬텀 단건 0: amount=1,400,000 활성 pkg=NULL 단건 부재(fa509f09 제거 확인)
  SELECT count(*) INTO v_phantom_singles
    FROM public.payments p
   WHERE p.customer_id = v_cust AND p.status = 'active'
     AND p.package_id IS NULL AND p.amount = 1400000 AND p.payment_type = 'payment';
  IF v_phantom_singles <> 0 THEN
    RAISE EXCEPTION 'ORACLE-FAIL 팬텀 단건 % (기대 0)', v_phantom_singles;
  END IF;

  RAISE NOTICE 'ORACLE PASS: pkg net=% paid=% balance=0 / single net=% / orphan=0 / phantom=0 / pay soft-del=% / pkg del=%',
    v_pkg_net, v_paid_new, v_single_net, v_pay_affected, v_pkg_deleted;
END $$;

-- 게이트 검증 후에만 COMMIT. dry-run/검토 시 ROLLBACK 으로 대체.
COMMIT;

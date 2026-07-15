-- ═══════════════════════════════════════════════════════════════════════════
-- T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR
-- Option 2 V-B(true-MOVE) archive-first apply  ★ apply 미실행 — 게이트 대기 ★
--
-- 근거: data-architect CONSULT-REPLY (MSG-20260715-162358-awo9) — V-B 조건부 GO(C1~C8).
--   DA 정본 규율: reversal/음수결제 금지(환불 아님). 정답 = archive-first MOVE
--   (orphan_archive_fk_guard_sop §1~§4 안전봉투 차용). 순소실0·원자·가역.
--
-- ★ 실행 금지 조건: 아래 3게이트 전량 GO 후에만 supervisor 가 apply.
--   [1차] DA CONSULT GO (수신·본 SQL 근거)
--   [2차] 김주연 총괄 재확인 (paid_amount 승인범위 초과·원장 접점 — planner→responder DECISION-REQUEST)
--   [3차] 형(대표) 인지 + supervisor DB-GATE(DDL-diff) + postverify
--        ※ payments_archive CREATE = DDL → migration_ledger_reconciliation 정합 필수.
--
-- 파괴성: canonical payments 행 DELETE(원장 정정). 단순 데이터정정 아님 — 대표게이트 재무장.
-- net-zero: single(payments) −69,000 + package_payments +69,000 → canonical Δ=0 (07-15 169,100 불변).
-- C7: 제거 single 의 tax_type 을 package_payments INSERT 에 명시 승계(등가 robust-by-construction).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── C1: archive 테이블은 migration 20260715180000_foot_payments_archive_singlepay_move.sql 이 SSOT.
--        (gate3 supervisor DB-GATE 에서 migration 선적용 → schema_migrations 신규 1행 → 3자 정합.)
--        컬럼 = (archive_id, archived_at, archive_ticket, archive_reason, original_id, original_row).
--        본 apply 는 그 테이블이 이미 존재한다고 가정(inline CREATE 금지 — SSOT 이중정의 divergence 차단).
DO $$ BEGIN
  IF to_regclass('public.payments_archive') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION ABORT: payments_archive 부재 — migration 20260715180000 선적용 필요(gate3 DB-GATE).';
  END IF;
END $$;

-- ── C3+C1+C2: freeze 2건 재검증(abort on drift) → archive → MOVE, 각 원자 처리 ────────
DO $$
DECLARE
  f            record;
  v_single     public.payments%ROWTYPE;
  v_match_cnt  integer;
  v_pp_cnt     integer;
  v_pkg_status text;
  v_pp_net     numeric;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('F-4666','2fdb6e06-259a-4bb6-a0d5-98978038dfa8'::uuid,'5ed60da7-990c-4407-9d63-cf61e1714789'::uuid,10000::numeric),
      ('F-4716','5050b17e-07a8-4cfa-bbbc-0717402c6142'::uuid,'3f4d3ec6-30e1-47a1-873d-3e798043f240'::uuid,59000::numeric)
    ) AS t(chart, customer_id, package_id, amount)
  LOOP
    -- C3-a: 활성 패키지 재검증
    SELECT status INTO v_pkg_status FROM public.packages WHERE id = f.package_id;
    IF v_pkg_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'C3 ABORT [%]: package % status=% (≠active drift)', f.chart, f.package_id, v_pkg_status;
    END IF;

    -- C3-b: package_payments 사전무존재(부분적용 drift 방지)
    SELECT count(*) INTO v_pp_cnt FROM public.package_payments WHERE package_id = f.package_id;
    IF v_pp_cnt <> 0 THEN
      RAISE EXCEPTION 'C3 ABORT [%]: package_payments 이미 % 행 존재(부분적용/drift)', f.chart, v_pp_cnt;
    END IF;

    -- C3-c: single 지문 단일매칭(단일 count 기준 금지 — 교집합 지문). 정확히 1행이어야.
    SELECT count(*) INTO v_match_cnt
      FROM public.payments p
     WHERE p.customer_id = f.customer_id
       AND p.amount = f.amount
       AND p.payment_type = 'payment'
       AND p.check_in_id IS NULL
       AND (p.memo LIKE '%영수증%' OR p.memo LIKE '%단건%')
       AND p.created_at >= '2026-07-15' AND p.created_at < '2026-07-16';
    IF v_match_cnt <> 1 THEN
      RAISE EXCEPTION 'C3 ABORT [%]: 지문매칭 %행 (≠1 — freeze 재특정 필요)', f.chart, v_match_cnt;
    END IF;

    SELECT * INTO v_single
      FROM public.payments p
     WHERE p.customer_id = f.customer_id
       AND p.amount = f.amount
       AND p.payment_type = 'payment'
       AND p.check_in_id IS NULL
       AND (p.memo LIKE '%영수증%' OR p.memo LIKE '%단건%')
       AND p.created_at >= '2026-07-15' AND p.created_at < '2026-07-16';

    -- C1: archive-first (전 컬럼 스냅샷 보존) — 순소실0. 컬럼=migration DDL SSOT.
    INSERT INTO public.payments_archive (archive_ticket, archive_reason, original_id, original_row)
    VALUES ('T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR',
            'V-B true-MOVE: 오귀속 single→활성pkg package_payments 재앵커(net-zero). credit 고아화(RC-B/RC-C) 정정.',
            v_single.id, to_jsonb(v_single));

    -- C2: MOVE (원자) — single 제거
    DELETE FROM public.payments WHERE id = v_single.id;

    -- C2: MOVE (원자) — package_payments 재기입. C7: source tax_type 명시 승계(등가).
    INSERT INTO public.package_payments
      (clinic_id, package_id, customer_id, amount, method, installment, payment_type, fee_kind, tax_type, memo, created_at)
    VALUES
      (v_single.clinic_id, f.package_id, f.customer_id, f.amount, v_single.method, 0, 'payment', 'package',
       v_single.tax_type,  -- ★C7 등가 승계 (freeze 실측 null → null; 비-null 이면 그대로 승계)
       '수기수납(패키지 잔금) — RECUR MOVE 재앵커 원본 payment '||left(v_single.id::text,8), v_single.created_at);

    -- paid_amount 재집계 = Σ signed(package_payments) (S1 캐시 정합)
    SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
      INTO v_pp_net FROM public.package_payments WHERE package_id = f.package_id;
    UPDATE public.packages SET paid_amount = v_pp_net WHERE id = f.package_id;

    RAISE NOTICE 'MOVE OK [%]: single % (₩%) → package_payments(pkg %) archived+moved, paid_amount=%',
      f.chart, left(v_single.id::text,8), f.amount, left(f.package_id::text,8), v_pp_net;
  END LOOP;

  -- ── C1b: 취소 pkg f48cb162 stranded paid_amount hygiene (planner xxjs/y09q ② — 동일 txn 재집계) ──
  --   F-4716 결제 후 pkg 취소·재생성(RC-B) → credit 이 취소 pkg f48cb162 에 paid_amount=59,000 로 고아 잔존.
  --   활성 3f4d3ec6 와 이중 paid_amount 계상 → MOVE 재집계와 동일 원리로 Σpackage_payments(=0) 로 재집계 → 0.
  --   ★별도 pre-gate write 금지 — 본 apply 트랜잭션 내 원자 실행. net-zero(paid_amount 캐시, 매출 원장 무접점).
  DECLARE
    v_cancel_status text;
    v_cancel_ppnet  numeric;
    v_cancel_paid   numeric;
  BEGIN
    SELECT status, paid_amount INTO v_cancel_status, v_cancel_paid
      FROM public.packages WHERE id = 'f48cb162-d480-4e37-9864-f560d15da16d';
    IF v_cancel_status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'C1b ABORT: f48cb162 status=% (≠cancelled drift — 재특정 필요)', v_cancel_status;
    END IF;
    SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
      INTO v_cancel_ppnet FROM public.package_payments WHERE package_id = 'f48cb162-d480-4e37-9864-f560d15da16d';
    UPDATE public.packages SET paid_amount = v_cancel_ppnet WHERE id = 'f48cb162-d480-4e37-9864-f560d15da16d';
    RAISE NOTICE 'C1b OK [F-4716]: 취소pkg f48cb162 paid_amount % → % (stranded 캐시 제거, Σpp=%)',
      v_cancel_paid, v_cancel_ppnet, v_cancel_ppnet;
  END;
END $$;

-- ── postverify 즉시 확인(트랜잭션 내) : S1·S2 both 0 기대 ────────────────────────────
-- (supervisor 는 COMMIT 후 postverify 스크립트로 3축 net-zero + 표시 일관 재확인)
COMMIT;

-- T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — 마감 전령 payload 패키지 누락 총액 SSOT conformance
--
-- SSOT: da_decision_foot_body_closing_herald_payload_pkg_reconcile_20260804.md (DA CONSULT-REPLY,
--       reply_id DA-20260804-foot-body-CLOSING-HERALD-PAYLOAD-PKG-RECONCILE, verdict=GO 조건부)
--       + closing_payload_split_reconciliation_spec.md v1.5 §1-5(패키지 원장 편입) + §3 INV5(총액 3중 대조)
--       + da_decision_foot_package_revenue_undercount_20260715.md (★dispositive 매출 SSOT = payments + package_payments)
--
-- ─── 무엇 (변경의 전부) ────────────────────────────────────────────────────────────
--   마감 전령 payload 의 total_amount_krw·split_source·split_insurance·month(MTD) 가 이제까지
--   payments 단독(payments-only net) 으로 산출돼 패키지 매출(package_payments)을 통째 누락(6~8배 과소).
--   이는 DA-20260715 undercount 버그의 payload-path 판본. 본 마이그는 수납 유니버스 S 를
--   canonical 매출 유니버스(payments + package_payments)로 확장한다(Q1·Q2).
--     S(패키지 보유 fork) = payments(net, card/cash/transfer[/health_maintenance])
--                         + package_payments(net, card/cash/transfer)   ★신규 편입
--   ★ 원장 mutation 0: package 는 package_payments 원장에 그대로 존치(이중원장). "결합"은
--     emit 쿼리에서 두 원장 net UNION 일 뿐 payments 테이블 물리병합 아님(DA §2 line 70).
--
-- ─── 4함수 변경 요약 ──────────────────────────────────────────────────────────────
--   1) closing_source_split      : payments net + package_payments net(source 귀속=미연결→organic, DA Q3-1).
--   2) closing_insurance_split   : payments net + package_payments net(전건 비급여 default → rev_noninsurance, DA Q3-2).
--   3) closing_month_projection  : MTD 유니버스에 package_payments net 편입(동일 유니버스 BINDING §1-5).
--   4) enqueue_closing_confirmed : INV5(총액 3중 대조) 하드 게이트 신설 + total_amount_krw 를 S 총액(v_total)으로.
--        INV5:  (total_amount_krw − Σhealth_maintenance) == Σsystem_totals == daily_closings 확정합.
--        발산 = emit-fail(발사 보류) + DLQ + 알람(삼킴 금지, DA Q4). 마감확정은 절대 비차단(안전계약 유지).
--
-- ─── 귀속 산식 (DA Q3, daily_closings.package_* 에 축 정보 없을 때 default) ─────────
--   • source(오가닉/광고) = 기존 reservations.source_system 규칙(revenue_source_split §2-1). package →
--       check_ins.package_id → reservation.source_system 이 'dopamine' → 광고, 그 외/예약미연결 → 오가닉
--       (기존 "미연결 흡수" 규칙이 커버 = src IS DISTINCT FROM 'dopamine' → organic. 신규 default 불요).
--   • insurance(급여/비급여/공단) = 비급여 domain default(발톱 패키지 = self-pay) → rev_noninsurance.
--       공단(rev_insurance_covered) 기여 = 0(비급여 패키지는 공단청구 없음·INV3 무접촉).
--
-- ─── 윈도잉 축 = created_at KST (Q1 권위 = daily_closings 컬럼과 동축, INV5 구조적 성립) ────────────
--   ★HARD census(2026-08-04 READ-ONLY prod) 판정: daily_closings.package_*/single_* 컬럼(= Q1 권위 총액)은
--   FE(Closing.tsx)가 payments/package_payments 를 `created_at` KST-day 윈도우로 집계해 확정한다. 따라서
--   payload split 유니버스를 동일 `(created_at AT TIME ZONE 'Asia/Seoul')::date = p_date` 로 윈도잉해야
--   tx-grain S == system_totals == daily_closings 확정합 이 구조적으로 성립(INV5 항등).
--   ⚠ census 실측: accounting_date 윈도우는 소급정정 11행(payments 4 + package 7, accounting_date≠created_at KST)
--     에서 daily_closings 컬럼과 발산(예: 08-01 sys 11,353,900 vs acct-window 12,772,700) → INV5 spurious-fail.
--     created_at KST 윈도우는 최근 마감 11/11 전건 sys_total 과 ±0 일치(08-01 포함). ∴ Q1 권위(daily_closings
--     컬럼)의 실제 산출축 = created_at → split 도 created_at 로 정렬(DA §6-c: 발산 원인=축 known → Q1 정렬로 해소,
--     authority 재정의 아님·re-CONSULT 불요). DA §2 accounting_date 명시는 planner FOLLOWUP 로 DA 인지 surface.
--   status='deleted' 수납 제외(FE .neq('status','deleted') parity) — 삭제행이 매출로 오계상되지 않게.
--   ⚠ 기존 pilot 은 COALESCE(revenue_date,refund_date,checked_in_at,created_at) 윈도우였음 → created_at KST 로
--     정렬(daily_closings 컬럼 동축·INV5 수렴). shadow 모드라 현장 무영향.
--
-- ─── HARD census (READ-ONLY, 구조 도출) ───────────────────────────────────────────
--   C1 유니버스·윈도잉: package_payments accounting_date(=created_at KST) parity ✓.
--   C2 이중계상 배타성(최중대): single(payments card/cash/transfer) ∩ package(package_payments) = ∅.
--       패키지 회차 소진 = payments.method='membership'(amount=0 마커, S밖) 또는 package_sessions(결제행 아님).
--       → 판매 cash-in 만 S 에 들어가고 소진은 무현금·미계상(C5 현금주의) → over-count 불가.
--   C3 source traceability: package → check_ins.package_id → reservation.source_system(linkage 有 per-tx /
--       미연결 → organic default). aggregate-only 아님(package_payments 트랜잭션 grain 실재).
--   C4 insurance discriminator: package_payments 에 급여 마커 부재 → 전건 비급여(기대치 = 발톱 self-pay).
--   C5 현금주의: package_payments.amount = 패키지 판매 cash-in(회차 소진 아님) ✓.
--   C6 stale snapshot: actual_* 는 트리거-시점 스냅샷 → total_amount_krw 권위를 v_total(emit-시점 recompute)로
--       이전(actual_* 는 totals{} 실카운트 audit·difference 동반·재emit로 refresh — 권위 아님).
--   C7 재emit: closing_confirmed_edit RPC(20260802160001)가 편집 시 revision+1 → enqueue 재발화 = 이미 배선.
--
-- change-class = ADDITIVE (payload 산식 정합·파괴 스키마 0·원장 mutation 0·롤백대칭)
--   → autonomy §3.1 대표게이트 면제(DA §5). 잔여 = supervisor DDL-diff/function-diff(트리거 접촉) + MIG-GATE.
--   magnitude-awareness(non-blocking): 전령 총액 정당 상향(누락 패키지 편입) = undercount 교정, 신규매출 아님.
-- AXIS-DATAPATH-GUARD 유지: payload-time 산식(Silver 미경유). 롱레 전령 무영향(foot fork-local 함수, 회귀0).
--
-- 멱등: 전부 CREATE OR REPLACE(시그니처 불변) → DROP 불요·42P13 불가·즉시 역전. 테이블/데이터/스키마 변경 0.
-- rollback: 20260804170000_foot_closing_herald_payload_pkg_reconcile.rollback.sql (직전 정본 함수 복원)
-- dryrun  : 20260804170000_foot_closing_herald_payload_pkg_reconcile.dryrun.sql (No-Persistence sentinel)
-- 작성: dev-foot / 2026-08-04

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) closing_source_split — 유입경로축 (payments + package_payments net) · INV1
--    ★v1.5: package_payments 편입(source 귀속=미연결→organic). 윈도잉=created_at KST(Q1 권위 동축). status='deleted' 제외.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH single_net AS (
    -- 단건(payments): 기존 유니버스 + created_at KST 윈도잉(Q1 권위 동축) + deleted 제외
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE                                    -- TESTPAY-SANDBOX: 테스트-수납 드롭
      AND p.status IS DISTINCT FROM 'deleted'                            -- FE parity(삭제 수납 매출 제외)
      AND p.method IN ('card','cash','transfer','health_maintenance')    -- Q5 membership 제외 유지 / HEALTHFEE 포함
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date        -- ★created_at KST 윈도잉(Q1 권위 동축·INV5 항등)
  ),
  pkg_net AS (
    -- ★v1.5 패키지(package_payments): source = package→check_in→reservation.source_system(미연결→organic default)
    SELECT
      (CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS net_amt,
      (SELECT r2.source_system
         FROM public.check_ins ci2
         JOIN public.reservations r2 ON r2.id = ci2.reservation_id
         WHERE ci2.package_id = pp.package_id
           AND r2.source_system IS NOT NULL
         ORDER BY ci2.checked_in_at ASC NULLS LAST
         LIMIT 1) AS src                                                 -- linkage 有 per-tx / NULL → organic(IS DISTINCT)
    FROM public.package_payments pp
    WHERE pp.clinic_id = p_clinic
      AND pp.is_simulation IS NOT TRUE                                   -- TESTPAY-SANDBOX: 테스트 패키지결제 드롭
      AND pp.method IN ('card','cash','transfer')                        -- package_payments CHECK = card/cash/transfer
      AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date       -- 양 원장 윈도잉 parity(C1·created_at KST)
  ),
  net AS (
    SELECT net_amt, src FROM single_net
    UNION ALL
    SELECT net_amt, src FROM pkg_net
  )
  SELECT jsonb_build_object(
    'revenue_ad',      COALESCE(SUM(net_amt) FILTER (WHERE src = 'dopamine'), 0),
    'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'), 0),
    'total',           COALESCE(SUM(net_amt), 0)
  )
  FROM net;
$$;

COMMENT ON FUNCTION public.closing_source_split(UUID, DATE) IS
  'T-CLOSING-HERALD: 유입경로축(오가닉/광고). ★v1.5 PAYLOAD-PKG-RECONCILE: payments + package_payments net '
  '(package source=미연결→organic default, DA Q3-1). 윈도잉=created_at KST(Q1 권위 동축). deleted 제외. dopamine=광고. '
  'revenue_ad+revenue_organic=total 항등(INV1). Q5 membership 제외 / HEALTHFEE 포함. is_simulation 드롭. Silver 미경유.';

-- ══════════════════════════════════════════════════════════════════
-- 2) closing_insurance_split — 급여구분축 (payments + package_payments net) · INV2/INV3
--    ★v1.5: package_payments 전건 비급여 default(rev_noninsurance). 공단(covered) 무접촉(INV3).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH single_net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      EXISTS (
        SELECT 1 FROM public.service_charges sc
        WHERE sc.check_in_id = p.check_in_id
          AND sc.is_insurance_covered = true
          AND sc.is_simulation IS NOT TRUE
      ) AS is_ins
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'                            -- FE parity
      AND p.method IN ('card','cash','transfer','health_maintenance')    -- HEALTHFEE=급여 본인부담(DA Q2)
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date        -- ★created_at KST 윈도잉(S 동일·INV5)
  ),
  pkg_net AS (
    -- ★v1.5 패키지: 전건 비급여 default(발톱 self-pay) → is_ins=false. 공단 무기여(INV3).
    SELECT
      (CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS net_amt,
      false AS is_ins
    FROM public.package_payments pp
    WHERE pp.clinic_id = p_clinic
      AND pp.is_simulation IS NOT TRUE
      AND pp.method IN ('card','cash','transfer')
      AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
  ),
  net AS (
    SELECT net_amt, is_ins FROM single_net
    UNION ALL
    SELECT net_amt, is_ins FROM pkg_net
  ),
  covered AS (
    -- 공단부담(rev_insurance_covered): 명세 grain, total 밖·INV3. 패키지 무기여 → 산식 불변.
    SELECT COALESCE(SUM(sc.insurance_covered_amount), 0) AS ins_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
      AND sc.is_simulation IS NOT TRUE
      AND sc.is_insurance_covered = true
      AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date
  )
  SELECT jsonb_build_object(
    'rev_copay_self',       COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins)     FROM net), 0),
    'rev_noninsurance',     COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net), 0),
    'rev_insurance_covered',(SELECT ins_covered FROM covered),
    'total',                COALESCE((SELECT SUM(net_amt) FROM net), 0)
  );
$$;

COMMENT ON FUNCTION public.closing_insurance_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot): 급여구분축. copay_self+noninsurance=total(INV2, S partition). '
  '★v1.5 PAYLOAD-PKG-RECONCILE: package_payments 전건 비급여 default(rev_noninsurance, DA Q3-2)·공단 무접촉(INV3). '
  'rev_insurance_covered=공단부담(명세 grain, total 밖·>=0, INV3 독립). 윈도잉=created_at KST. HEALTHFEE=copay_self.';

-- ══════════════════════════════════════════════════════════════════
-- 3) closing_month_projection — MTD 유니버스에 package_payments 편입(동일 유니버스 BINDING §1-5)
--    ★윈도잉=created_at KST 통일(Q1 권위 동축). closed 마감일 위의 payments + package_payments net 합.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_month_projection(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start   DATE := date_trunc('month', p_date)::date;
  v_month_end     DATE := (date_trunc('month', p_date) + INTERVAL '1 month - 1 day')::date;
  v_activation    DATE;
  v_eff_start     DATE;
  v_mtd           BIGINT;
  v_days_done     INT;
  v_days_in_month INT;
  v_avg_daily     NUMERIC;
  v_projection    BIGINT;
  v_partial       BOOLEAN;
BEGIN
  SELECT activation_date INTO v_activation
    FROM public.closing_confirmed_config WHERE id = true;
  v_eff_start := GREATEST(v_month_start, COALESCE(v_activation, v_month_start));
  v_partial   := (v_eff_start > v_month_start);

  SELECT COALESCE(SUM(x.net_amt), 0)
  INTO v_mtd
  FROM (
    -- 단건(payments)
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS eff_date,
      COALESCE(p.clinic_id, ci.clinic_id) AS attr_clinic
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method IN ('card','cash','transfer','health_maintenance')
    UNION ALL
    -- ★v1.5 패키지(package_payments) — 동일 유니버스 BINDING
    SELECT
      (CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS net_amt,
      (pp.created_at AT TIME ZONE 'Asia/Seoul')::date AS eff_date,
      pp.clinic_id AS attr_clinic
    FROM public.package_payments pp
    WHERE pp.is_simulation IS NOT TRUE
      AND pp.method IN ('card','cash','transfer')
  ) x
  WHERE x.attr_clinic = p_clinic
    AND x.eff_date >= v_eff_start
    AND x.eff_date <= p_date
    AND EXISTS (
      SELECT 1 FROM public.daily_closings dc
      WHERE dc.clinic_id = p_clinic
        AND dc.close_date = x.eff_date
        AND dc.status = 'closed'
    );

  v_days_done     := (p_date - v_eff_start) + 1;
  v_days_in_month := (v_month_end - v_month_start) + 1;
  v_avg_daily  := CASE WHEN v_days_done > 0 THEN v_mtd::numeric / v_days_done ELSE NULL END;
  v_projection := CASE WHEN v_avg_daily IS NOT NULL THEN round(v_avg_daily * v_days_in_month) ELSE NULL END;

  RETURN jsonb_build_object(
    'month',              to_char(v_month_start, 'YYYY-MM'),
    'mtd_amount_krw',     v_mtd,
    'revenue_mtd_krw',    v_mtd,
    'days_done',          v_days_done,
    'days_in_month',      v_days_in_month,
    'avg_daily_krw',      CASE WHEN v_avg_daily IS NULL THEN NULL ELSE round(v_avg_daily) END,
    'mtm_projection_krw', v_projection,
    'is_projection',      true,
    'partial_month',      v_partial,
    'vat_included',       false,
    'basis',              '수납',
    'formula',            'MTD=SUM(net) over closed-closing dates [eff_start..as_of]; '
                       || 'universe=payments + package_payments(v1.5 PKG-RECONCILE); '
                       || 'eff_start=max(month_start, activation); MTM=round(MTD/days_done*days_in_month); '
                       || 'day-basis=calendar; window=created_at KST; net excl membership(Q5), incl health_maintenance.'
  );
END;
$$;

COMMENT ON FUNCTION public.closing_month_projection(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 월 관점(MTD+MTM projection). is_projection=true(추정). '
  '★v1.5 PAYLOAD-PKG-RECONCILE: MTD 유니버스 = payments + package_payments(동일 유니버스 BINDING §1-5). '
  '윈도잉=created_at KST. Q7 activation 이후 실영업일 + partial_month 라벨.';

-- ══════════════════════════════════════════════════════════════════
-- 4) enqueue_closing_confirmed — INV5(총액 3중 대조) 하드 게이트 + total_amount_krw = S 총액(v_total)
--    INV5: (total_amount_krw − Σhealth_maintenance) == Σsystem_totals == daily_closings 확정합.
--      · Σsystem_totals ≡ daily_closings 확정합 (동일 package_*+single_* 컬럼 → 2·3항 by construction 동일).
--      · v_hm = health_maintenance net(daily_closings 4버킷 컬럼에 미포함 = 알려진 delta·MEDAID1 PhaseA).
--      · 발산 = emit-fail(발사 보류·status='failed'·dlq=true) + DLQ 알람(삼킴 금지). 마감확정 비차단.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_closing_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entering_closed BOOLEAN;
  v_slug      TEXT;
  v_payload   JSONB;
  -- source split
  v_src       JSONB;
  v_total     BIGINT;
  v_ad        BIGINT;
  v_org       BIGINT;
  v_src_ok    BOOLEAN := false;
  -- insurance split
  v_ins       JSONB;
  v_copay     BIGINT;
  v_nonins    BIGINT;
  v_covered   BIGINT;
  v_ins_ok    BOOLEAN := false;
  -- month
  v_month     JSONB;
  v_sys_total BIGINT;
  -- ★INV5 (v1.5)
  v_hm        BIGINT := 0;          -- health_maintenance net(4버킷 컬럼 미포함 delta)
  v_inv5_ok   BOOLEAN := true;
  v_status    TEXT := 'pending';
  v_dlq       BOOLEAN := false;
  v_lasterr   TEXT := NULL;
BEGIN
  v_entering_closed := (NEW.status = 'closed')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed');
  IF NOT v_entering_closed THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.clinics WHERE id = NEW.clinic_id;

  -- ★안전계약: payload 빌드/적재 전체를 예외 격리. 어떤 실패도 마감확정(open→closed)을 롤백시키지 않는다.
  BEGIN

  -- ── daily_closings 확정합 = Σ system_totals(package_*+single_* by method) = INV5 권위 ──
  v_sys_total := COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0)
               + COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0)
               + COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);

  -- ── v_hm: health_maintenance net(공단 건강생활유지비 대납, MEDAID1 PhaseA) — 4버킷 컬럼에 미포함되는 알려진 delta ──
  SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END), 0)
    INTO v_hm
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = NEW.clinic_id
      AND p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method = 'health_maintenance'
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = NEW.close_date;

  -- ── base payload (schema_version 1) ──
  --   totals{} = actual_*(원장 실카운트·difference 동반 audit·재emit로 refresh). system_totals{} = emit-시점 recompute.
  --   ★권위 총액 = total_amount_krw(아래 v_total, package 포함 S) — actual_* 스냅샷은 권위 아님(C6).
  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     (NEW.revision > 0),
    'schema_version', 1,
    'totals', jsonb_build_object(
      'card',          COALESCE(NEW.actual_card_total,0),
      'cash',          COALESCE(NEW.actual_cash_total,0),
      'bank_transfer', COALESCE(NEW.actual_transfer_total,0),
      'other',         0
    ),
    'system_totals', jsonb_build_object(
      'card',          COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0),
      'cash',          COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0),
      'bank_transfer', COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0),
      'other',         0
    ),
    'difference',     NEW.difference,
    'memo',           NEW.memo,
    'confirmed_by',   NEW.confirmed_by,
    'confirmed_at',   to_char(COALESCE(NEW.closed_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- ── 유입경로축 split_source (payments + package_payments): INV1(ad+organic==total) + INV4 ──
  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  v_src_ok := (v_total IS NOT NULL)
              AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total)
              AND (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  -- ── ★INV5(총액 3중 대조): (v_total − v_hm) == v_sys_total. package 포함 유니버스 = 구조적 수렴 ──
  --    v_total(payments+package net, incl hm) − v_hm(4버킷 컬럼 미포함) == v_sys_total(package_*+single_* 컬럼).
  v_inv5_ok := (v_total IS NOT NULL) AND ((v_total - COALESCE(v_hm,0)) = COALESCE(v_sys_total,0));

  IF v_src_ok AND v_inv5_ok THEN
    -- 정상: schema_version 2 + total_amount_krw(=S 총액, package 포함) + split_source
    v_payload := v_payload
      || jsonb_build_object('schema_version', 2)
      || jsonb_build_object('total_amount_krw', v_total)
      || jsonb_build_object('split_source',
           jsonb_build_object('revenue_ad', v_ad, 'revenue_organic', v_org));

    -- ── 급여구분축 split_insurance (payments + package net): INV2 + INV3 + INV4 ──
    v_ins     := public.closing_insurance_split(NEW.clinic_id, NEW.close_date);
    v_copay   := (v_ins ->> 'rev_copay_self')::BIGINT;
    v_nonins  := (v_ins ->> 'rev_noninsurance')::BIGINT;
    v_covered := (v_ins ->> 'rev_insurance_covered')::BIGINT;
    v_ins_ok  := (COALESCE(v_copay,0) + COALESCE(v_nonins,0) = v_total)   -- INV2
                 AND (COALESCE(v_copay,0) >= 0) AND (COALESCE(v_nonins,0) >= 0)  -- INV4
                 AND (COALESCE(v_covered,0) >= 0);                        -- INV3(>=0, total 밖)
    IF v_ins_ok THEN
      v_payload := v_payload || jsonb_build_object('split_insurance',
        jsonb_build_object(
          'rev_copay_self',        v_copay,
          'rev_noninsurance',      v_nonins,      -- ★package 전건 여기로 흡수(비급여 default)
          'rev_insurance_covered', v_covered      -- INV3: total 미합산(청구 grain)
        ));
    ELSE
      RAISE LOG 'enqueue_closing_confirmed: insurance split INV 위반(copay=% nonins=% total=% covered=%) clinic=% date=% — split_insurance 생략(graceful)',
        v_copay, v_nonins, v_total, v_covered, v_slug, NEW.close_date;
    END IF;

  ELSIF v_src_ok AND NOT v_inv5_ok THEN
    -- ★INV5 발산 = emit-fail(발사 보류) + DLQ + 알람(삼킴 금지, DA Q4). 마감확정은 유지(비차단).
    --   총액 3중 대조 실패(stale snapshot·이중계상·윈도잉 발산 등) → 잘못된 전령 발사 금지.
    v_status  := 'failed';
    v_dlq     := true;
    v_lasterr := format('INV5 총액 3중 대조 발산: (total_amount_krw %s − health_maintenance %s) <> daily_closings 확정합 %s (source split ad=%s org=%s)',
                        v_total, v_hm, v_sys_total, v_ad, v_org);
    v_payload := v_payload
      || jsonb_build_object('schema_version', 1)
      || jsonb_build_object('inv5_divergence', jsonb_build_object(
           'total_s',            v_total,
           'health_maintenance', v_hm,
           'system_totals_sum',  v_sys_total,
           'delta',              (v_total - COALESCE(v_hm,0) - COALESCE(v_sys_total,0))
         ));
    RAISE LOG 'enqueue_closing_confirmed: %  clinic=% date=% — emit-fail(DLQ, 발사 보류)',
      v_lasterr, v_slug, NEW.close_date;
  ELSE
    -- source INV1 위반: split 신뢰불가 → schema_version 1 발사(기존 거동)
    RAISE LOG 'enqueue_closing_confirmed: source split INV1 위반(ad=% org=% total=%) clinic=% date=% — split 생략, schema_version=1 발사',
      v_ad, v_org, v_total, v_slug, NEW.close_date;
  END IF;

  -- ── 월 관점(month) — graceful EXCEPTION 격리(Q7). INV5-fail 이어도 month 는 정보성(발사 보류 대상 아님) ──
  IF v_status <> 'failed' THEN
    BEGIN
      v_month := public.closing_month_projection(NEW.clinic_id, NEW.close_date);
      IF v_month IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('month', v_month);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'enqueue_closing_confirmed: month projection 실패(%) clinic=% date=% — month 생략',
        SQLERRM, v_slug, NEW.close_date;
    END;
  END IF;

  -- ── outbox INSERT (INV5-fail 시 status=failed·dlq=true → 워커 dispatch 제외·DLQ 알람. 멱등) ──
  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload, status, dlq, dlq_alerted, last_error)
  VALUES (
    NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, (NEW.revision > 0),
    v_payload, v_status, v_dlq, false, v_lasterr
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    -- payload 빌드/적재 실패 → 마감확정은 유지. 최소 v1 payload 재시도(emit 유실 방지).
    RAISE LOG 'enqueue_closing_confirmed: 전체 실패(%) clinic=% date=% — 마감확정 유지, 최소 payload 재시도',
      SQLERRM, v_slug, NEW.close_date;
    BEGIN
      INSERT INTO public.closing_confirmed_outbox
        (clinic_id, clinic_slug, close_date, revision, superseded, payload)
      VALUES (
        NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, (NEW.revision > 0),
        jsonb_build_object(
          'source_system',  'foot',
          'clinic_slug',    v_slug,
          'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
          'revision',       NEW.revision,
          'superseded',     (NEW.revision > 0),
          'schema_version', 1,
          'degraded',       true
        )
      )
      ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'enqueue_closing_confirmed: 최소 payload INSERT도 실패(%) — emit 유실, 마감확정만 유지', SQLERRM;
    END;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_closing_confirmed() IS
  'T-CLOSING-HERALD: 확정 전이(open→closed) → payload(schema_version 2) 빌드 + INV1~5 self-test → outbox 적재. '
  '★v1.5 PAYLOAD-PKG-RECONCILE: total_amount_krw·split = payments + package_payments(패키지 편입) · '
  'INV5(총액 3중 대조: (total−hm)==system_totals==daily_closings 확정합) 하드 게이트·발산 시 emit-fail+DLQ(삼킴 금지). '
  'source 실패→v1 / insurance 실패→graceful 생략(Q4). 마감확정 절대 비차단. clinic_slug 필수. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재 (트리거 재생성 불요, 함수만 교체)

COMMIT;

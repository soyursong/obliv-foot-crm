-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260806150000_foot_closing_herald_totals_recompute_port
-- Ticket: T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT (P1, approved · CEO MSG-20260806-142527-yzrc)
-- 부모: T-20260718-meta-CLOSING-HERALD-XCRM-PROGRAM / program: closing-herald-cross-crm-port
-- supersedes-approach-of: T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (마이그 170000/200000, deployed)
-- 포팅 참조: obliv-body-crm 20260804_body_568_closing_herald_totals_recompute_reconcile.sql (deployed 08-05 supervisor GO)
-- DA envelope(무접촉·ADDITIVE·신규 CONSULT 불요): da_decision_foot_body_closing_herald_payload_pkg_reconcile_20260804.md
--   Q1('권위총액 = daily_closings 확정 구성분 emit-시점 recompute · stale actual_* DEPRECATE') / §4(totals.* 통일)
--   + closing_payload_split_reconciliation_spec.md v1.7 (§1-5 유니버스·INV5·윈도잉=created_at KST·REDEFINITION_RISK 가드)
--
-- ── 무엇 (직전 배포본이 왜 실패했나 — PROD READ-ONLY census 2026-08-06) ─────────────
--   직전 170000/200000(deployed)은 total_amount_krw·split·month 를 payments net + package_payments net
--   UNION 쿼리(closing_source_split 등 ledger 재조회)로 산출. ★census 실측(dev-foot, jongno-foot):
--     · 08-05 outbox rev0 = status=failed·total NULL·INV5 발산 "total_amount_krw 0" (emit-시점 split=0)
--     · 08-06 outbox rev0 = status=failed·동형
--     · 08-04 outbox rev0 = total=0(가드 前 오보·pending·superseded=false)
--   그런데 지금 closing_source_split 을 직접 호출하면 08-05=5,617,000 을 반환(daily_closings sys_total=5,587,000).
--   ∴ 근본 = ledger 재조회의 emit-시점 point-in-time DRIFT — 마감확정(트리거 발화) 순간 payments/package_payments
--   윈도우가 daily_closings 확정 구성분(FE 가 확정 write 한 컬럼)과 발산(마감 후 등재행·타이밍). ledger 를
--   권위 총액 소스로 쓰는 한 재현. (★ticket 가설 'package_payments 원장 rows 부재'는 census 로 반증 — rows 실재.
--   그러나 처방은 동일: ledger 재조회 폐기, daily_closings 확정 구성분 직접 recompute = body_568 산식.)
--   ⚠ split−sys diff(08-01: 8,800 / 08-05: 30,000)는 health_maintenance 아님(hm net=0 실측) = 순수 post-close drift.
--
-- ── 무엇 (해결) — AC1/AC2/AC3 · body_568 산식 포팅 ────────────────────────────────
--   권위 총액·전 split·month 를 daily_closings 확정 구성분(package_*+single_* by method: card/cash/transfer,
--   membership 제외 Q5, health_maintenance 미포함=4버킷 컬럼 밖)에서 직접 recompute. ledger net 쿼리 폐기.
--     · total_amount_krw = v_sys_total = Σ(package_card+package_cash+package_transfer
--                                          + single_card+single_cash+single_transfer)                     [AC1]
--     · totals.* = system_totals = 동일 확정 구성분 recompute (stale actual_* 폐기 — body_568 §4 통일)     [AC1]
--     · split_source     : revenue_ad = ledger 실귀속(dopamine, card/cash/transfer, created_at KST — 단건
--                          payments + 패키지 package_payments dopamine-linked) · revenue_organic = v_sys_total
--                          − revenue_ad (미연결/aggregate 흡수 = DA Q3-1 organic default). ad+organic==total 항등(INV1).
--     · split_insurance  : rev_copay_self = 단건 payments(card/cash/transfer) 중 급여청구(service_charges) 존재분 ·
--                          rev_noninsurance = v_sys_total − copay (패키지 전건 비급여 흡수 = DA Q3-2) ·
--                          rev_insurance_covered = 명세 공단부담(total 밖·INV3 독립). copay+nonins==total(INV2).
--     · month(MTD)       : Σ daily_closings 확정 구성분 over closed close_dates [eff_start..as_of] (동일 유니버스).
--   ★residual 흡수 산식(organic/noninsurance = v_sys_total − 귀속분)이 INV1/INV2 를 구조적으로 보장하며,
--     ledger drift 로 귀속분이 v_sys_total 초과 시 GREATEST/LEAST 클램프로 음수·초과 방지(INV4).
--
-- ── INV5(총액 3중 대조) — AC3 유지 ────────────────────────────────────────────────
--   INV5:  total_amount_krw(= v_total, closing_source_split 반환 = daily_closings sys_total)
--            ==  Σ system_totals(package_*+single_* 4버킷)  ==  daily_closings 확정합
--   세 항 모두 동일 확정 구성분에서 파생 → 구조적 수렴(package 포함). closing_source_split 가 daily_closings 를
--   authority 로 읽고 enqueue 는 NEW 컬럼으로 v_sys_total 재계산 → 교차대조(함수 read vs 트리거 NEW). 발산 시
--   emit-fail(발사 보류)+DLQ(삼킴 금지, DA Q4). ★health_maintenance −보정 제거(총액이 4버킷 컬럼 = hm 밖).
--
-- ── 불변 (200000 supersede-fix 계승) ──────────────────────────────────────────────
--   신규 outbox 행 superseded=false 고정 + 동일(clinic,close_date) revision<NEW.revision UPDATE superseded=true.
--   → 리더 가시본 = 신 rev · 구 rev 전건 superseded=true (reemit 정당경로 자연 수렴). main + degraded 경로 각자 동봉.
--
-- ── 변경 범위 (4함수 CREATE OR REPLACE — 스키마·원장·데이터 mutation 0) ────────────
--   1) closing_source_split      : ledger UNION-net → daily_closings sys_total authority + ad residual.
--   2) closing_insurance_split   : 동형 (copay residual · covered 명세 grain 유지).
--   3) closing_month_projection  : MTD 유니버스 = daily_closings 확정 구성분(ledger net 폐기).
--   4) enqueue_closing_confirmed : total=v_sys_total · totals=system_totals recompute(stale actual_* 폐기) ·
--                                  INV5(v_total==v_sys_total, hm 보정 제거) · 200000 supersede-fix 계승.
--   ★read_closing_confirmed_events / confirm_guard / 트리거 배선 = 무접촉(회귀 0).
--
-- change-class = ADDITIVE (payload 산식 정합·stale-snapshot deprecate·파괴 스키마 0·원장 mutation 0·롤백대칭)
--   → autonomy §3.1 대표게이트 면제(DA envelope 확정). 신규 컬럼/테이블/enum 0 → §S2.4 DA CONSULT 불요.
--   db_change=true(함수 재정의) → MIG-GATE + supervisor DDL-diff/function-diff(4함수). AXIS-DATAPATH-GUARD 유지
--   (payload-time 산식·Silver 미경유). 롱레/derm/scalp2 전령 무영향(별 레포·fork-local emit 함수·회귀 0).
--
-- ── C23-1 intended-caller-tier 선언 (SECDEF grant-seal, §15-5-10) ─────────────────
--   4함수 전부 SECURITY DEFINER · backend-only(FE src/·EF functions/ 직접 RPC 호출부 grep 0건 — 170000 census 계승).
--   CREATE OR REPLACE 는 Supabase public default privileges 재부여 위험 → 하단 §Y per-fn REVOKE PUBLIC/anon/
--   authenticated + GRANT service_role + anon-EXEC=0 assert. blanket ALTER DEFAULT PRIVILEGES 금지(C23-4).
--
-- ── MIG-SCOPE(§13.1.C) — same-(domain=foot, fn 4종) 이중 authoring ────────────────
--   직전 170000/200000(deployed) 위 CREATE OR REPLACE. C10/C19 baseline = 200000 apply본 md5(prosrc, 2026-08-06 census):
--     enqueue=ed372fc2d3e382218617ee31a5108dc2 · source_split=8c4218ecef182d7986ce101fcc8fbfbe
--     insurance_split=2e75908ecadf160099b639ab94777663 · month_projection=841d9519128710d2d38329e5222faece
--   supervisor MIG-GATE 재대조 필수(200000 baseline 기준 4함수 diff).
--
-- 멱등: 전부 CREATE OR REPLACE FUNCTION(시그니처 불변) → DROP 불요·42P13 불가·즉시 역전. 테이블/데이터/스키마 변경 0.
-- rollback: 20260806150000_foot_closing_herald_totals_recompute_port.rollback.sql (200000 정본 4함수 복원·grant-seal 유지)
-- dryrun  : 20260806150000_foot_closing_herald_totals_recompute_port.dryrun.mjs (No-Persistence sentinel + assertAbsent)
-- prod apply = supervisor 전속(herald 계열, body_568 pair). dev-foot = dry-run 무영속 + 실측 evidence + 재emit 러너 제공.
-- 마커: 'TOTALS-RECOMPUTE-PORT' (assertAbsent 무영속 실증용).
-- 작성: dev-foot / 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) closing_source_split — 유입경로축 (daily_closings 확정 구성분 authority + ad residual) · INV1
--    ★TOTALS-RECOMPUTE-PORT: total = daily_closings sys_total. ledger UNION-net 폐기.
--    revenue_ad = dopamine 실귀속(단건+패키지, card/cash/transfer, created_at KST). organic = sys_total − ad(흡수).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sys_total BIGINT;
  v_ad_raw    BIGINT;
  v_ad        BIGINT;
  v_org       BIGINT;
BEGIN
  -- ── 권위 총액 = daily_closings 확정 구성분(package_*+single_* by method) — AC1 ──
  SELECT COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
       + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
       + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)
    INTO v_sys_total
    FROM public.daily_closings dc
   WHERE dc.clinic_id = p_clinic AND dc.close_date = p_date
   ORDER BY dc.revision DESC
   LIMIT 1;
  v_sys_total := COALESCE(v_sys_total, 0);

  -- ── 광고(dopamine) 실귀속: card/cash/transfer only(v_sys 유니버스 정합·hm/membership 밖), created_at KST ──
  --    단건 payments(reservation.source_system='dopamine') + 패키지 package_payments(package→check_in→reservation dopamine).
  SELECT COALESCE(SUM(net_amt), 0)
    INTO v_ad_raw
    FROM (
      -- 단건(payments)
      SELECT (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt
        FROM public.payments p
        LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
        LEFT JOIN public.reservations r ON r.id = ci.reservation_id
       WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
         AND p.is_simulation IS NOT TRUE
         AND p.status IS DISTINCT FROM 'deleted'
         AND p.method IN ('card','cash','transfer')
         AND r.source_system = 'dopamine'
         AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
      UNION ALL
      -- 패키지(package_payments) dopamine-linked
      SELECT (CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS net_amt
        FROM public.package_payments pp
       WHERE pp.clinic_id = p_clinic
         AND pp.is_simulation IS NOT TRUE
         AND pp.method IN ('card','cash','transfer')
         AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
         AND EXISTS (
           SELECT 1 FROM public.check_ins ci2
           JOIN public.reservations r2 ON r2.id = ci2.reservation_id
           WHERE ci2.package_id = pp.package_id
             AND r2.source_system = 'dopamine')
    ) x;

  -- ── residual 흡수(DA Q3-1): organic = sys_total − ad. 클램프로 음수·초과 방지(INV4) → INV1 항등 보장 ──
  v_ad  := GREATEST(0, LEAST(COALESCE(v_ad_raw, 0), GREATEST(v_sys_total, 0)));
  v_org := v_sys_total - v_ad;

  RETURN jsonb_build_object(
    'revenue_ad',      v_ad,
    'revenue_organic', v_org,
    'total',           v_sys_total
  );
END;
$$;

COMMENT ON FUNCTION public.closing_source_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 유입경로축(오가닉/광고). total=daily_closings 확정 구성분 '
  '(package_*+single_* by method) authority. revenue_ad=dopamine 실귀속(단건+패키지·card/cash/transfer·created_at KST). '
  'revenue_organic=total−ad(미연결/aggregate 흡수 DA Q3-1). ad+organic==total 항등(INV1). ledger UNION-net 폐기. Silver 미경유.';

-- ══════════════════════════════════════════════════════════════════
-- 2) closing_insurance_split — 급여구분축 (daily_closings authority + copay residual) · INV2/INV3
--    ★TOTALS-RECOMPUTE-PORT: total = daily_closings sys_total. copay = 단건 급여청구분 · nonins = 흡수(패키지 전건 비급여).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sys_total BIGINT;
  v_copay_raw BIGINT;
  v_copay     BIGINT;
  v_nonins    BIGINT;
  v_covered   BIGINT;
BEGIN
  -- ── 권위 총액 = daily_closings 확정 구성분 (AC1·source_split 동일 유니버스) ──
  SELECT COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
       + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
       + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)
    INTO v_sys_total
    FROM public.daily_closings dc
   WHERE dc.clinic_id = p_clinic AND dc.close_date = p_date
   ORDER BY dc.revision DESC
   LIMIT 1;
  v_sys_total := COALESCE(v_sys_total, 0);

  -- ── 급여 본인부담(copay) = 단건 payments(card/cash/transfer) 중 급여청구(service_charges) 존재분. created_at KST ──
  --    패키지 = 전건 비급여(DA Q3-2) → copay 미가산(패키지분은 nonins 흡수).
  SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END), 0)
    INTO v_copay_raw
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
   WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
     AND p.is_simulation IS NOT TRUE
     AND p.status IS DISTINCT FROM 'deleted'
     AND p.method IN ('card','cash','transfer')
     AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
     AND EXISTS (
       SELECT 1 FROM public.service_charges sc
       WHERE sc.check_in_id = p.check_in_id
         AND sc.is_insurance_covered = true
         AND sc.is_simulation IS NOT TRUE);

  -- ── residual 흡수: noninsurance = sys_total − copay(패키지 전건 흡수). 클램프(INV4) → INV2 항등 보장 ──
  v_copay  := GREATEST(0, LEAST(COALESCE(v_copay_raw, 0), GREATEST(v_sys_total, 0)));
  v_nonins := v_sys_total - v_copay;

  -- ── 공단부담(rev_insurance_covered): 명세 grain, total 밖·INV3(>=0). 패키지 무기여(비급여). 170000 산식 유지 ──
  SELECT COALESCE(SUM(sc.insurance_covered_amount), 0)
    INTO v_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
   WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
     AND sc.is_simulation IS NOT TRUE
     AND sc.is_insurance_covered = true
     AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date;

  RETURN jsonb_build_object(
    'rev_copay_self',        v_copay,
    'rev_noninsurance',      v_nonins,
    'rev_insurance_covered', COALESCE(v_covered, 0),
    'total',                 v_sys_total
  );
END;
$$;

COMMENT ON FUNCTION public.closing_insurance_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 급여구분축. total=daily_closings 확정 구성분 authority. '
  'rev_copay_self=단건 급여청구분(service_charges covered)·rev_noninsurance=total−copay(패키지 전건 비급여 흡수 DA Q3-2). '
  'copay+nonins==total(INV2). rev_insurance_covered=공단부담(명세 grain·total 밖·>=0·INV3 독립). ledger net 폐기.';

-- ══════════════════════════════════════════════════════════════════
-- 3) closing_month_projection — MTD 유니버스 = daily_closings 확정 구성분(동일 유니버스 BINDING §1-5)
--    ★TOTALS-RECOMPUTE-PORT: closed 마감일의 daily_closings sys_total 합. payments/package_payments net 폐기.
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

  -- ── MTD = Σ daily_closings 확정 구성분(package_*+single_*) over closed close_dates [eff_start..as_of] ──
  --    ★ledger net 폐기 → daily_closings actual 직접 합(AC1 동일 유니버스·drift 봉인).
  SELECT COALESCE(SUM(
           COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
         + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
         + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)
         ), 0)
    INTO v_mtd
    FROM public.daily_closings dc
   WHERE dc.clinic_id = p_clinic
     AND dc.status = 'closed'
     AND dc.close_date >= v_eff_start
     AND dc.close_date <= p_date;

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
    'formula',            'MTD=SUM(daily_closings 확정구성분 package_*+single_*) over closed close_dates [eff_start..as_of]; '
                       || 'universe=daily_closings actual(v1.7 TOTALS-RECOMPUTE-PORT · ledger net 폐기); '
                       || 'eff_start=max(month_start, activation); MTM=round(MTD/days_done*days_in_month); '
                       || 'day-basis=calendar; excl membership(Q5)/health_maintenance(4버킷 컬럼 밖).'
  );
END;
$$;

COMMENT ON FUNCTION public.closing_month_projection(UUID, DATE) IS
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 마감 시점 월 관점(MTD+MTM projection). is_projection=true. '
  'MTD 유니버스 = Σ daily_closings 확정 구성분(package_*+single_*) over closed close_dates(ledger net 폐기·동일 유니버스 BINDING). '
  'Q7 activation 이후 실영업일 + partial_month 라벨.';

-- ══════════════════════════════════════════════════════════════════
-- 4) enqueue_closing_confirmed — total=v_sys_total · totals=system_totals recompute · INV5(hm 보정 제거)
--    + 200000 supersede-fix 계승(신규 superseded=false + 구 rev UPDATE). body_568 §4 totals 통일 포팅.
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
  -- month + 확정 구성분 recompute buckets
  v_month     JSONB;
  v_sys_card     BIGINT;
  v_sys_cash     BIGINT;
  v_sys_transfer BIGINT;
  v_sys_total    BIGINT;
  -- INV5 + DLQ
  v_inv5_ok   BOOLEAN := false;
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

  -- ── 확정 구성분 recompute (emit-시점) — package_*+single_* by method = 권위 확정합(DA Q1/§4) ──
  --    ★stale actual_* 폐기: totals·system_totals·total_amount_krw 전부 이 recompute 구성분에서 파생(통일).
  v_sys_card     := COALESCE(NEW.package_card_total,0)     + COALESCE(NEW.single_card_total,0);
  v_sys_cash     := COALESCE(NEW.package_cash_total,0)     + COALESCE(NEW.single_cash_total,0);
  v_sys_transfer := COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);
  v_sys_total    := v_sys_card + v_sys_cash + v_sys_transfer;

  -- ── base payload (schema_version 1) ──
  --   ★TOTALS-RECOMPUTE-PORT: totals.* = 확정 구성분 recompute(= system_totals). stale actual_* 폐기(frozen-snapshot 안티패턴 금지).
  --   ★200000 supersede-fix 계승: 신규 행 superseded=false(구 rev supersede 는 아래 UPDATE).
  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     false,
    'schema_version', 1,
    'totals', jsonb_build_object(     -- ★DA §4 통일: emit-시점 확정 구성분 recompute(= system_totals). stale actual_* 폐기.
      'card',          v_sys_card,
      'cash',          v_sys_cash,
      'bank_transfer', v_sys_transfer,
      'other',         0
    ),
    'system_totals', jsonb_build_object(   -- ★권위 확정 구성분 = total_amount_krw 대조 authority(= totals 동일 SSOT)
      'card',          v_sys_card,
      'cash',          v_sys_cash,
      'bank_transfer', v_sys_transfer,
      'other',         0
    ),
    'difference',     NEW.difference,
    'memo',           NEW.memo,
    'confirmed_by',   NEW.confirmed_by,
    'confirmed_at',   to_char(COALESCE(NEW.closed_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- ── 유입경로축 split_source (daily_closings authority): INV1(ad+organic==total) + INV4 ──
  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;               -- = daily_closings sys_total(함수 read) — v_sys_total 과 대조
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  v_src_ok := (v_total IS NOT NULL)
              AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total)
              AND (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  -- ── ★INV5(총액 3중 대조): v_total(함수 daily_closings read) == v_sys_total(트리거 NEW 컬럼) == Σsystem_totals ──
  --    세 항 동일 확정 구성분 파생 → 구조적 수렴. hm −보정 제거(총액 = 4버킷 컬럼 = hm 밖).
  v_inv5_ok := (v_total IS NOT NULL) AND (v_total = v_sys_total);

  IF v_src_ok AND v_inv5_ok THEN
    -- 정상: schema_version 2 + total_amount_krw(= 권위 확정합) + split_source
    v_payload := v_payload
      || jsonb_build_object('schema_version', 2)
      || jsonb_build_object('total_amount_krw', v_total)
      || jsonb_build_object('split_source',
           jsonb_build_object('revenue_ad', v_ad, 'revenue_organic', v_org));

    -- ── 급여구분축 split_insurance (daily_closings authority): INV2 + INV3 + INV4 ──
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
    v_status  := 'failed';
    v_dlq     := true;
    v_lasterr := format('INV5 총액 3중 대조 발산: total_amount_krw(함수 %s) <> daily_closings 확정합(NEW %s) (source split ad=%s org=%s)',
                        v_total, v_sys_total, v_ad, v_org);
    v_payload := v_payload
      || jsonb_build_object('schema_version', 1)
      || jsonb_build_object('inv5_divergence', jsonb_build_object(
           'total_fn',          v_total,
           'system_totals_sum', v_sys_total,
           'delta',             (v_total - COALESCE(v_sys_total,0))
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

  -- ── ★200000 supersede-fix 계승(b): 구 rev supersede — 동일(clinic,close_date) revision<NEW.revision UPDATE ──
  --   신규 rev 가 리더 가시본이 되고 구 rev 전건이 superseded=true 로 수렴. INSERT 와 동일 블록(원자성).
  UPDATE public.closing_confirmed_outbox
     SET superseded = true
   WHERE clinic_id = NEW.clinic_id
     AND close_date = NEW.close_date
     AND revision < NEW.revision
     AND COALESCE(superseded, false) = false;

  -- ── outbox INSERT (신규 행 superseded=false 고정. INV5-fail 시 status=failed·dlq=true → 워커 제외·DLQ 알람. 멱등) ──
  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload, status, dlq, dlq_alerted, last_error)
  VALUES (
    NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, false,
    v_payload, v_status, v_dlq, false, v_lasterr
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    -- payload 빌드/적재 실패 → 마감확정은 유지. 최소 v1 payload 재시도(emit 유실 방지).
    RAISE LOG 'enqueue_closing_confirmed: 전체 실패(%) clinic=% date=% — 마감확정 유지, 최소 payload 재시도',
      SQLERRM, v_slug, NEW.close_date;
    BEGIN
      -- ★200000 supersede-fix 계승: degraded 경로 자체 supersede-UPDATE(격리 savepoint 롤백 대비 재실행)
      UPDATE public.closing_confirmed_outbox
         SET superseded = true
       WHERE clinic_id = NEW.clinic_id
         AND close_date = NEW.close_date
         AND revision < NEW.revision
         AND COALESCE(superseded, false) = false;

      INSERT INTO public.closing_confirmed_outbox
        (clinic_id, clinic_slug, close_date, revision, superseded, payload)
      VALUES (
        NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, false,
        jsonb_build_object(
          'source_system',  'foot',
          'clinic_slug',    v_slug,
          'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
          'revision',       NEW.revision,
          'superseded',     false,
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
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 확정 전이(open→closed) → payload(schema_version 2) 빌드 + INV1~5 → outbox. '
  '★total_amount_krw=daily_closings 확정 구성분(package_*+single_*, ledger net 폐기). totals=system_totals recompute(stale actual_* 폐기). '
  'INV5(v_total==v_sys_total==Σsystem_totals, hm 보정 제거) 하드 게이트·발산 시 emit-fail+DLQ. '
  '200000 supersede-fix 계승(신규 superseded=false + 구 rev UPDATE). source/insurance 실패→graceful. 마감확정 절대 비차단. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재 (트리거 재생성 불요, 함수만 교체)

-- ══════════════════════════════════════════════════════════════════
-- Y) SECURITY DEFINER grant-seal (C23 · §15-5-10) — 4함수 backend-only 봉인 재동봉
--    ★CREATE OR REPLACE default 재부여 대비. intended-caller-tier = backend-only(전 4함수 · grep 0건).
-- ══════════════════════════════════════════════════════════════════
DO $seal$
DECLARE
  v_fn   TEXT;
  v_fns  TEXT[] := ARRAY[
    'public.closing_source_split(uuid,date)',      -- 매출 반환(유입경로축) · SECDEF · backend-only
    'public.closing_insurance_split(uuid,date)',   -- 매출 반환(급여구분축) · SECDEF · backend-only
    'public.closing_month_projection(uuid,date)',  -- 매출 반환(MTD) · SECDEF · backend-only
    'public.enqueue_closing_confirmed()'           -- 트리거 · SECDEF · backend-only
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated;', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', v_fn);
    IF has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'grant-seal FAIL: anon 이 여전히 % EXECUTE 가능(봉인 미착지)', v_fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'grant-seal(C23): 4 함수 backend-only 봉인 + anon-EXEC=0 assert 4/4 통과';
END
$seal$;

-- ══════════════════════════════════════════════════════════════════
-- 적용시점 self-test (실패 시 EXCEPTION → 배포 중단) — TOTALS-RECOMPUTE-PORT 실증 + 회귀가드
-- ══════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure) INTO v_def;

  -- (1) ★stale actual_* 폐기 실증 — payload emit 소스에 actual_*_total 잔재 0(DA §4 통일)
  IF v_def ~ 'actual_card_total' OR v_def ~ 'actual_cash_total' OR v_def ~ 'actual_transfer_total' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue payload emit 소스에 stale actual_* 잔재 — DA §4 DEPRECATE 위반(frozen-snapshot 재발).';
  END IF;
  -- (2) ★totals recompute 통일 실증 — totals·system_totals·total 전부 v_sys_card/v_sys_cash/v_sys_total 확정 구성분 참조
  IF v_def !~ 'v_sys_card' OR v_def !~ 'v_sys_cash' OR v_def !~ 'v_sys_total' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue 에 확정 구성분 recompute(v_sys_card/v_sys_cash/v_sys_total) 부재 — totals 통일 미이행.';
  END IF;
  -- (3) ★INV5 hm −보정 제거 실증 — health_maintenance 소스 잔재 0(총액 = 4버킷 컬럼)
  IF v_def ~ 'health_maintenance' OR v_def ~ 'v_hm' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue 에 health_maintenance/v_hm 잔재 — hm −보정 미제거(총액≠4버킷 컬럼 위반).';
  END IF;
  -- (4) 200000 supersede-fix 계승 — 구 revision supersede UPDATE 실재(회귀 방지)
  IF v_def !~ 'revision\s*<\s*NEW\.revision' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue 구 revision supersede UPDATE(revision < NEW.revision) 부재 — 200000 fix 회귀.';
  END IF;
  -- (5) self-supersede 역전 패턴 재발 방지 — (NEW.revision > 0) 잔재 0
  IF position('(NEW.revision > 0)' IN v_def) <> 0 THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue 역전 패턴(superseded=(NEW.revision>0)) 잔존 — 200000 회귀.';
  END IF;
  -- (6) INV5 게이트 유지(회귀 방지)
  IF v_def !~ 'v_inv5_ok' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT: enqueue INV5 게이트 부재(회귀).';
  END IF;
  -- (7) C23 grant-seal 실증: anon EXECUTE 잔존 시 배포 중단(4함수 fail-closed)
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.closing_source_split(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.closing_insurance_split(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.closing_month_projection(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C23 grant-seal 미결착: 4함수 중 anon EXECUTE 잔존.';
  END IF;
  RAISE NOTICE 'TOTALS-RECOMPUTE-PORT self-test 통과 (totals=system_totals=확정구성분 · stale actual_* 0 · hm 보정 제거 · supersede[200000] 유지 · 역전패턴 0 · INV5 유지 · C23 seal[anon EXEC 0])';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 사후 검증 (supervisor prod apply 후):
--   1) apply 후 정당경로 재emit(reemit 러너 --apply) 3일: 08-04 · 08-05 · 08-06
--      · 신행 payload.total_amount_krw == daily_closings 확정합(± 0) == Σsystem_totals == Σtotals
--      · 08-05/08-06 status=failed→신 rev pending·dlq=false(INV5 통과) · 08-04 rev0(total0 오보) superseded=true
--   2) 신행 totals == system_totals (card/cash/bank_transfer/other 4버킷 1:1 동일).
--   3) 신행 superseded=false · 구 rev 전건 superseded=true · read_closing_confirmed_events 신 rev 가시.
--   4) daily_closings monetary(package_*/single_*/actual_*) 무변 — payload 산식 축만 접촉(ledger net 폐기).
--   5) 08-01~08-06 payload total == daily_closings actual 원단위 일치(DoD). 롱레/derm/scalp2 전령 무영향.
-- ────────────────────────────────────────────────────────────────────────────

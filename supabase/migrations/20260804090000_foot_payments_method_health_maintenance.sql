-- T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT-BTN-PHASEA
-- 의료급여1종 + 건강생활유지비(국가 지원금) 잔액 → 수납창 '공단 차감'
--
-- 무엇: payments.method CHECK 에 canonical 값 'health_maintenance' 1개 가산(ADDITIVE, DA GO — CONSULT-REPLY
--   MSG-20260803-220917-se51, Option 1). 공단(건강생활유지비) 대납분(₩1,000 등)을 별도 결제수단으로 기록해
--   실수납 0원이 대사(payments↔service_charges)를 깨지 않게 한다(수납완료 settled·현금주의 §7-3 정상).
--
-- 왜 ADDITIVE:
--   • CHECK 을 widen 만 함(기존 4값 유지 + 1값 추가) → 기존행 무효화 0 · 데이터 mutation 0 · 롤백 대칭.
--   • funding_source 일반 컬럼은 NOT-NOW(DA: membership 선례가 funding-source-as-method 패턴 커버).
--   • 토큰 'health_maintenance' = cross-CRM 캐논(정의=cross-CRM, 실행=foot fork-local). derm/body 동형 시 재사용.
--
-- ★AC4-GATE(b) silent-drop 금지: 마감 herald 3함수(closing_source_split / closing_insurance_split /
--   closing_month_projection)의 매출 유니버스 method IN 리스트에 'health_maintenance' 를 가산한다.
--   건강생활유지비 대납분은 실현매출(현금주의)이므로 card/cash/transfer 와 동일 유니버스에 포함되어야 대사가
--   깨지지 않는다(membership=선불 use 는 여전히 제외 유지 — Q5 불변). FE 일마감 grossTotal 도 동형 반영(Closing.tsx).
--   ※ split 함수 본문은 20260731113000(testpay is_simulation) 정본과 동일 — method IN conjunct 만 확장.
--     closing_month_projection 은 20260718140000(herald pilot) 정본과 동일 — method IN conjunct 만 확장.
--
-- change-class = ADDITIVE → §3.1 대표게이트 면제. supervisor DDL-diff / MIG-GATE 만.
-- rollback : 20260804090000_foot_payments_method_health_maintenance.rollback.sql
-- dryrun   : 20260804090000_foot_payments_method_health_maintenance.dryrun.sql (No-Persistence sentinel)

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) payments.method CHECK widen — 'health_maintenance' 가산(멱등)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('card','cash','transfer','membership','health_maintenance'));

COMMENT ON CONSTRAINT payments_method_check ON public.payments IS
  'T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT: card/cash/transfer/membership + health_maintenance(공단 '
  '건강생활유지비 대납, 의료급여1종). ADDITIVE widen(DA GO Option1). 토큰=cross-CRM 캐논.';

-- ══════════════════════════════════════════════════════════════════
-- 2) 마감 herald 유니버스 확장 — health_maintenance 실현매출 포함(silent-drop 금지, AC4-GATE b)
--    ※ 본문은 각 정본과 동일. method IN (...) 에 'health_maintenance' 만 추가. membership 은 계속 제외(Q5).
-- ══════════════════════════════════════════════════════════════════

-- 2-a) closing_source_split (정본: 20260731113000 — is_simulation 상류 드롭 유지)
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE                                    -- TESTPAY-SANDBOX: 테스트-수납 드롭
      AND p.method IN ('card','cash','transfer','health_maintenance')    -- ★HEALTHFEE: 공단 대납 실현매출 포함(Q5 membership 제외 유지)
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  )
  SELECT jsonb_build_object(
    'revenue_ad',      COALESCE(SUM(net_amt) FILTER (WHERE src = 'dopamine'), 0),
    'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'), 0),
    'total',           COALESCE(SUM(net_amt), 0)
  )
  FROM net;
$$;

COMMENT ON FUNCTION public.closing_source_split(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 유입경로축(오가닉/광고) 즉시 산출. dopamine=광고. '
  'revenue_ad+revenue_organic=total 항등(INV1). Q5 membership 제외. Silver 미경유(AXIS-DATAPATH-GUARD). '
  'is_simulation IS NOT TRUE 상류 드롭. ★HEALTHFEE: health_maintenance(공단 대납) 실현매출 유니버스 포함.';

-- 2-b) closing_insurance_split (정본: 20260731113000)
CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
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
      AND p.method IN ('card','cash','transfer','health_maintenance')    -- ★HEALTHFEE: 공단 대납 = rev_copay_self(급여 본인부담) 유지(DA Q2)
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  ),
  covered AS (
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
  'T-CLOSING-HERALD(foot 신규): 급여구분축. copay_self+noninsurance=total(INV2, S partition). '
  'rev_insurance_covered=공단부담(명세 grain, total 밖·>=0, INV3 독립). Q2 기존 보험축(is_insurance_covered). '
  'is_simulation IS NOT TRUE 상류 드롭. ★HEALTHFEE: health_maintenance = rev_copay_self(급여 본인부담) 유지(DA Q2).';

-- 2-c) closing_month_projection (정본: 20260718140000 — MTD/MTM)
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
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      COALESCE(
        NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
        CASE WHEN p.payment_type = 'refund'
             THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
        ci.checked_in_at::date,
        p.created_at::date
      ) AS eff_date,
      COALESCE(p.clinic_id, ci.clinic_id) AS attr_clinic
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE p.method IN ('card','cash','transfer','health_maintenance')    -- ★HEALTHFEE: MTD 유니버스에도 공단 대납 실현매출 포함
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
                       || 'eff_start=max(month_start, activation); MTM=round(MTD/days_done*days_in_month); '
                       || 'day-basis=calendar; net excl membership(Q5), incl health_maintenance; source=foot daily_closings(closed).'
  );
END;
$$;

COMMENT ON FUNCTION public.closing_month_projection(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 월 관점(MTD+MTM projection). is_projection=true(추정). '
  'Q7 activation 이후 실영업일만 + partial_month 라벨. ★HEALTHFEE: health_maintenance 실현매출 포함.';

COMMIT;

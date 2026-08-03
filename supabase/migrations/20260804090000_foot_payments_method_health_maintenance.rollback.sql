-- ROLLBACK — T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT-BTN-PHASEA
-- 대칭 역: (2) herald 3함수 method IN 리스트에서 'health_maintenance' 제거(정본 복원) → (1) CHECK 4값 복원.
-- ⚠ CHECK 축소 전제: 롤백 시점 payments 에 method='health_maintenance' 행이 없어야 함(있으면 ADD 실패).
--   존재 시 정본 매출 대사 훼손 방지 위해 데이터 정리 판단 선행(파괴적 조작은 Data-Correction Backfill SOP 봉투).

BEGIN;

-- 2-c rev) closing_month_projection 정본(20260718140000) 복원 — health_maintenance 제거.
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
    WHERE p.method IN ('card','cash','transfer')
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
                       || 'day-basis=calendar; net excl membership(Q5); source=foot daily_closings(closed).'
  );
END;
$$;

-- 2-b rev) closing_insurance_split 정본(20260731113000) 복원 — health_maintenance 제거.
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
      AND p.method IN ('card','cash','transfer')
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

-- 2-a rev) closing_source_split 정본(20260731113000) 복원 — health_maintenance 제거.
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
      AND p.is_simulation IS NOT TRUE
      AND p.method IN ('card','cash','transfer')
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

-- 1 rev) payments.method CHECK 4값 복원.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('card','cash','transfer','membership'));

COMMIT;

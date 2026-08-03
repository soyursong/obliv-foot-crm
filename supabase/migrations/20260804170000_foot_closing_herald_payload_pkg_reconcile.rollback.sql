-- ROLLBACK — T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE
-- 대칭 역: 4함수를 직전 정본으로 CREATE OR REPLACE 복원(시그니처 불변·즉시 역전). 데이터/스키마 무접촉.
--   · closing_source_split / closing_insurance_split / closing_month_projection → 20260804090000(health_maintenance) 정본
--   · enqueue_closing_confirmed → 20260718140000(herald pilot) 정본
-- ⚠ 복원 후 payload 는 다시 payments-only(패키지 누락 undercount 판본) + INV5 미적용 soft-log 로 되돌아감.
--   shadow 모드 전제(현장 무영향). live 운영 중 롤백 시 전령 총액이 undercount 로 하락함에 유의.

BEGIN;

-- ─── 1) closing_source_split (20260804090000 정본 복원 — package 편입 제거) ───
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
      AND p.method IN ('card','cash','transfer','health_maintenance')
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

-- ─── 2) closing_insurance_split (20260804090000 정본 복원) ───
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
      AND p.method IN ('card','cash','transfer','health_maintenance')
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

-- ─── 3) closing_month_projection (20260804090000 정본 복원 — package 편입 제거·checked_in_at 윈도우) ───
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
    WHERE p.method IN ('card','cash','transfer','health_maintenance')
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

-- ─── 4) enqueue_closing_confirmed (20260718140000 herald pilot 정본 복원 — INV5 게이트 제거·payments-grain soft-log) ───
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
  v_src       JSONB;
  v_total     BIGINT;
  v_ad        BIGINT;
  v_org       BIGINT;
  v_src_ok    BOOLEAN := false;
  v_ins       JSONB;
  v_copay     BIGINT;
  v_nonins    BIGINT;
  v_covered   BIGINT;
  v_ins_ok    BOOLEAN := false;
  v_month     JSONB;
  v_sys_total BIGINT;
BEGIN
  v_entering_closed := (NEW.status = 'closed')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed');
  IF NOT v_entering_closed THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.clinics WHERE id = NEW.clinic_id;

  BEGIN

  v_sys_total := COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0)
               + COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0)
               + COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);
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

  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  v_src_ok := (v_total IS NOT NULL)
              AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total)
              AND (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  IF v_src_ok THEN
    IF v_total IS DISTINCT FROM v_sys_total THEN
      RAISE LOG 'enqueue_closing_confirmed: payments-grain total(%) <> system 버킷합(%) clinic=% date=% — payments-grain 발사',
        v_total, v_sys_total, v_slug, NEW.close_date;
    END IF;
    v_payload := v_payload
      || jsonb_build_object('schema_version', 2)
      || jsonb_build_object('total_amount_krw', v_total)
      || jsonb_build_object('split_source',
           jsonb_build_object('revenue_ad', v_ad, 'revenue_organic', v_org));

    v_ins     := public.closing_insurance_split(NEW.clinic_id, NEW.close_date);
    v_copay   := (v_ins ->> 'rev_copay_self')::BIGINT;
    v_nonins  := (v_ins ->> 'rev_noninsurance')::BIGINT;
    v_covered := (v_ins ->> 'rev_insurance_covered')::BIGINT;
    v_ins_ok  := (COALESCE(v_copay,0) + COALESCE(v_nonins,0) = v_total)
                 AND (COALESCE(v_copay,0) >= 0) AND (COALESCE(v_nonins,0) >= 0)
                 AND (COALESCE(v_covered,0) >= 0);
    IF v_ins_ok THEN
      v_payload := v_payload || jsonb_build_object('split_insurance',
        jsonb_build_object(
          'rev_copay_self',        v_copay,
          'rev_noninsurance',      v_nonins,
          'rev_insurance_covered', v_covered
        ));
    ELSE
      RAISE LOG 'enqueue_closing_confirmed: insurance split INV 위반(copay=% nonins=% total=% covered=%) clinic=% date=% — split_insurance 생략(graceful)',
        v_copay, v_nonins, v_total, v_covered, v_slug, NEW.close_date;
    END IF;
  ELSE
    RAISE LOG 'enqueue_closing_confirmed: source split INV1 위반(ad=% org=% total=%) clinic=% date=% — split 생략, schema_version=1 발사',
      v_ad, v_org, v_total, v_slug, NEW.close_date;
  END IF;

  BEGIN
    v_month := public.closing_month_projection(NEW.clinic_id, NEW.close_date);
    IF v_month IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('month', v_month);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'enqueue_closing_confirmed: month projection 실패(%) clinic=% date=% — month 생략',
      SQLERRM, v_slug, NEW.close_date;
  END;

  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload)
  VALUES (
    NEW.clinic_id,
    v_slug,
    NEW.close_date,
    NEW.revision,
    (NEW.revision > 0),
    v_payload
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
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
  'INV1 유입=total / INV2 급여=total / INV3 공단 total밖·>=0 / INV4 각 split>=0 / INV5 유니버스 S 동일. '
  'source 실패→v1 / insurance 실패→graceful 생략(Q4). clinic_slug 필수. 멱등 ON CONFLICT.';

COMMIT;

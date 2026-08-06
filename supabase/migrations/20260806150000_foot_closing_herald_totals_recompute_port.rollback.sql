-- ROLLBACK — T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT
-- 대칭 역: 4함수를 직전 정본(200000 baseline)으로 CREATE OR REPLACE 복원.
--   · closing_source_split / closing_insurance_split / closing_month_projection = 20260804170000 정본(ledger UNION-net)
--   · enqueue_closing_confirmed = 20260804200000 정본(supersede-fix · payments+package net · stale actual_* totals · INV5 hm 보정)
--   시그니처 불변·즉시 역전. 데이터/스키마 무접촉.
-- ⚠ 복원 후 total_amount_krw·split·month 는 다시 ledger net 재조회 판본으로 되돌아감 → point-in-time drift 재현
--   (08-05/08-06 emit-시점 split=0 INV5 발산 재발 가능). ∴ 라이브 운영 중 롤백은 알려진 결함 상태로의 복귀.
-- ★grant-seal 대칭 유지: SECDEF 봉인(REVOKE PUBLIC/anon/authenticated + GRANT service_role) 유지(anon 재노출 금지).
-- 작성: dev-foot / 2026-08-06

BEGIN;

-- ═══ 1) closing_source_split (20260804170000 정본 복원 — payments + package_payments net) ═══
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH single_net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method IN ('card','cash','transfer','health_maintenance')
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
  ),
  pkg_net AS (
    SELECT
      (CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS net_amt,
      (SELECT r2.source_system
         FROM public.check_ins ci2
         JOIN public.reservations r2 ON r2.id = ci2.reservation_id
         WHERE ci2.package_id = pp.package_id
           AND r2.source_system IS NOT NULL
         ORDER BY ci2.checked_in_at ASC NULLS LAST
         LIMIT 1) AS src
    FROM public.package_payments pp
    WHERE pp.clinic_id = p_clinic
      AND pp.is_simulation IS NOT TRUE
      AND pp.method IN ('card','cash','transfer')
      AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
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

-- ═══ 2) closing_insurance_split (20260804170000 정본 복원 — payments + package_payments net) ═══
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
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method IN ('card','cash','transfer','health_maintenance')
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = p_date
  ),
  pkg_net AS (
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

-- ═══ 3) closing_month_projection (20260804170000 정본 복원 — payments + package_payments net MTD) ═══
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
      (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS eff_date,
      COALESCE(p.clinic_id, ci.clinic_id) AS attr_clinic
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method IN ('card','cash','transfer','health_maintenance')
    UNION ALL
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

-- ═══ 4) enqueue_closing_confirmed (20260804200000 정본 복원 — supersede-fix · ledger net · stale actual_* · INV5 hm) ═══
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
  v_hm        BIGINT := 0;
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

  BEGIN

  v_sys_total := COALESCE(NEW.package_card_total,0) + COALESCE(NEW.single_card_total,0)
               + COALESCE(NEW.package_cash_total,0) + COALESCE(NEW.single_cash_total,0)
               + COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);

  SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END), 0)
    INTO v_hm
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = NEW.clinic_id
      AND p.is_simulation IS NOT TRUE
      AND p.status IS DISTINCT FROM 'deleted'
      AND p.method = 'health_maintenance'
      AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = NEW.close_date;

  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     false,
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

  v_inv5_ok := (v_total IS NOT NULL) AND ((v_total - COALESCE(v_hm,0)) = COALESCE(v_sys_total,0));

  IF v_src_ok AND v_inv5_ok THEN
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

  ELSIF v_src_ok AND NOT v_inv5_ok THEN
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
    RAISE LOG 'enqueue_closing_confirmed: source split INV1 위반(ad=% org=% total=%) clinic=% date=% — split 생략, schema_version=1 발사',
      v_ad, v_org, v_total, v_slug, NEW.close_date;
  END IF;

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

  UPDATE public.closing_confirmed_outbox
     SET superseded = true
   WHERE clinic_id = NEW.clinic_id
     AND close_date = NEW.close_date
     AND revision < NEW.revision
     AND COALESCE(superseded, false) = false;

  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload, status, dlq, dlq_alerted, last_error)
  VALUES (
    NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, false,
    v_payload, v_status, v_dlq, false, v_lasterr
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'enqueue_closing_confirmed: 전체 실패(%) clinic=% date=% — 마감확정 유지, 최소 payload 재시도',
      SQLERRM, v_slug, NEW.close_date;
    BEGIN
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

-- ═══ grant-seal 재봉인 (대칭 유지·anon 재노출 금지) ═══
DO $seal$
DECLARE
  v_fn   TEXT;
  v_fns  TEXT[] := ARRAY[
    'public.closing_source_split(uuid,date)',
    'public.closing_insurance_split(uuid,date)',
    'public.closing_month_projection(uuid,date)',
    'public.enqueue_closing_confirmed()'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated;', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', v_fn);
  END LOOP;
END
$seal$;

COMMIT;

NOTIFY pgrst, 'reload schema';

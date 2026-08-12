-- ROLLBACK: 20260812180000_foot_closing_enqueue_divergence_loudfail
--   → 20260806150000_foot_closing_herald_totals_recompute_port 의 enqueue_closing_confirmed 정본 verbatim 복원
--     (B-narrow divergence-loud-fail 제거 → primary ON CONFLICT = plain DO NOTHING 환원).
--   대칭·가역: CREATE OR REPLACE(시그니처 불변) → 즉시 역전. 테이블/데이터/스키마 변경 0.
--   ★불변: TOTALS-RECOMPUTE-PORT 산식·INV1~5·200000 supersede-fix·grant-seal 전부 그대로(B-narrow 지점만 환원).
-- 작성: dev-foot / 2026-08-12

BEGIN;

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
  v_sys_card     BIGINT;
  v_sys_cash     BIGINT;
  v_sys_transfer BIGINT;
  v_sys_total    BIGINT;
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

  BEGIN

  v_sys_card     := COALESCE(NEW.package_card_total,0)     + COALESCE(NEW.single_card_total,0);
  v_sys_cash     := COALESCE(NEW.package_cash_total,0)     + COALESCE(NEW.single_cash_total,0);
  v_sys_transfer := COALESCE(NEW.package_transfer_total,0) + COALESCE(NEW.single_transfer_total,0);
  v_sys_total    := v_sys_card + v_sys_cash + v_sys_transfer;

  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     false,
    'schema_version', 1,
    'totals', jsonb_build_object(
      'card',          v_sys_card,
      'cash',          v_sys_cash,
      'bank_transfer', v_sys_transfer,
      'other',         0
    ),
    'system_totals', jsonb_build_object(
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

  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  v_src_ok := (v_total IS NOT NULL)
              AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total)
              AND (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  v_inv5_ok := (v_total IS NOT NULL) AND (v_total = v_sys_total);

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

COMMENT ON FUNCTION public.enqueue_closing_confirmed() IS
  'T-CLOSING-HERALD(foot) v1.7 TOTALS-RECOMPUTE-PORT: 확정 전이(open→closed) → payload(schema_version 2) 빌드 + INV1~5 → outbox. '
  '★total_amount_krw=daily_closings 확정 구성분(package_*+single_*, ledger net 폐기). totals=system_totals recompute(stale actual_* 폐기). '
  'INV5(v_total==v_sys_total==Σsystem_totals, hm 보정 제거) 하드 게이트·발산 시 emit-fail+DLQ. '
  '200000 supersede-fix 계승(신규 superseded=false + 구 rev UPDATE). source/insurance 실패→graceful. 마감확정 절대 비차단. 멱등 ON CONFLICT.';

DO $seal$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.enqueue_closing_confirmed() TO service_role;
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'grant-seal FAIL(rollback): anon 이 여전히 enqueue_closing_confirmed EXECUTE 가능';
  END IF;
  RAISE NOTICE 'rollback: enqueue_closing_confirmed → 806150000 정본(plain DO NOTHING) 복원 + grant-seal 유지';
END
$seal$;

COMMIT;

-- ROLLBACK — T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (FIX-REQUEST supersede fix)
-- 대칭 역: enqueue_closing_confirmed 를 직전 정본(20260804170000 package-reconcile)으로 CREATE OR REPLACE 복원.
--   시그니처 불변·즉시 역전. 데이터/스키마 무접촉. split 3함수는 본 FIX 가 무접촉 → rollback 도 무접촉.
-- ⚠ 복원 후 enqueue 는 다시 `superseded=(NEW.revision>0)` self-supersede 판본으로 되돌아감(리더 rev>0 불가시 재현).
--   ∴ 라이브 운영 중 롤백 시 재emit(rev≥1) 이 다시 불가시화됨에 유의(FIX 이전 상태 = 알려진 결함 상태).
-- ★grant-seal 대칭 유지: SECDEF 봉인(REVOKE PUBLIC/anon/authenticated + GRANT service_role)은 유지.
--   현 PUBLIC EXECUTE 상태로 되돌리지 않음 = 봉인 유지가 정상 역전(anon 재노출 금지).

BEGIN;

-- ─── enqueue_closing_confirmed (20260804170000 package-reconcile 정본 복원 — self-supersede 판본) ───
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

  INSERT INTO public.closing_confirmed_outbox
    (clinic_id, clinic_slug, close_date, revision, superseded, payload, status, dlq, dlq_alerted, last_error)
  VALUES (
    NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, (NEW.revision > 0),
    v_payload, v_status, v_dlq, false, v_lasterr
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
  '★v1.5 PAYLOAD-PKG-RECONCILE: total_amount_krw·split = payments + package_payments(패키지 편입) · '
  'INV5(총액 3중 대조: (total−hm)==system_totals==daily_closings 확정합) 하드 게이트·발산 시 emit-fail+DLQ(삼킴 금지). '
  'source 실패→v1 / insurance 실패→graceful 생략(Q4). 마감확정 절대 비차단. clinic_slug 필수. 멱등 ON CONFLICT.';

-- ─── grant-seal 대칭 유지 (봉인 원복 아님·유지) — anon 재노출 금지 ───
DO $seal$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.enqueue_closing_confirmed() TO service_role;
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback grant-seal FAIL: anon 이 여전히 enqueue_closing_confirmed EXECUTE 가능';
  END IF;
  RAISE NOTICE 'rollback grant-seal(C23): enqueue_closing_confirmed backend-only 봉인 유지 + anon-EXEC=0 assert 통과';
END
$seal$;

COMMIT;

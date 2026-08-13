-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple
--   → 20260806150000_foot_closing_herald_totals_recompute_port 의 enqueue_closing_confirmed 정본 verbatim 복원
--     (INV1-SPLITSIGN-DECOUPLE 제거 → v_src_ok 합+부호 결합 guard 환원 · total 게이트가 다시 split-sign 에 결합).
--   대칭·가역: CREATE OR REPLACE(시그니처 불변) → 즉시 역전. 테이블/데이터/스키마 변경 0.
--   ★불변: TOTALS-RECOMPUTE-PORT 산식·foot DLQ 기제(v_status/v_dlq/v_lasterr)·200000 supersede-fix·안전계약·
--          source_system=foot·3함수(source_split/insurance_split/month_projection)·grant-seal 전부 그대로(decouple 지점만 환원).
--   ⚠주의: 롤백 시 split-sign 결합결함이 되돌아온다 — 음수 광고매출(정당 cross-day 환불)이 다시 known-correct total 발사를 차단(sv1/NULL).
--          rollback = enqueue only 이며 outbox 데이터는 불변.
-- 작성: dev-foot / 2026-08-13
-- ════════════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════
-- Y) SECURITY DEFINER grant-seal (C23 · §15-5-10) — enqueue backend-only 봉인 재동봉
-- ══════════════════════════════════════════════════════════════════
DO $seal$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.enqueue_closing_confirmed() TO service_role;
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'grant-seal FAIL: anon 이 여전히 enqueue_closing_confirmed EXECUTE 가능(봉인 미착지)';
  END IF;
  RAISE NOTICE 'grant-seal(C23): enqueue_closing_confirmed backend-only 봉인 + anon-EXEC=0 assert 통과';
END
$seal$;

COMMIT;

NOTIFY pgrst, 'reload schema';

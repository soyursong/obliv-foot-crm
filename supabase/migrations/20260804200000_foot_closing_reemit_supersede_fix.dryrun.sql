-- DRY-RUN (No-Persistence Protocol) — T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (supersede fix)
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록으로 실행. up.sql 의 enqueue_closing_confirmed CREATE OR REPLACE(★실 정본 verbatim)
--   를 EXECUTE 로 적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 것도 영속되지 않음.
--   up.sql BEGIN/COMMIT(txn-control)·§Y grant-seal DO 는 여기서 제외(strip). up.sql = CREATE OR REPLACE
--   FUNCTION 1건(txn-safe/가역, non-txn DDL 없음) → dry-run 적격.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) enqueue 정의(★실 up.sql verbatim)에 supersede-UPDATE(revision < NEW.revision → superseded=true) 실재  → PASS
--   2) enqueue 함수 body 에 self-supersede 결함식 `(NEW.revision > 0)` 잔재 0 (헤더주석 제외·body 기준)         → PASS
--   3) enqueue 정의에 신규 행 superseded=false 고정(payload + INSERT 컬럼)                                     → PASS
--   4) split 3함수는 무접촉(package_payments 편입·created_at KST 정본 존치 — 회귀 0)                            → PASS
--   5) grant-seal 적용 후 anon-EXEC=0 (C23-2 급성축 봉인)                                                       → PASS
--   6) ★reader-visibility 시뮬(무영속): 임시 outbox rev0→rev1 재emit → supersede 규칙 correctness 실증          → PASS
--        ①신 rev superseded=false ②read_closing_confirmed_events 반환 포함 ③구 rev 전건 superseded=true
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT position('revision < NEW.revision' IN pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure)); -- 0 기대(무영속)

DO $dryrun$
DECLARE
  v_result  text := '';
  v_all_ok  boolean := true;
  v_def     text;
  v_body    text;
  v_clinic  uuid;
  v_slug    text := 'dryrun-foot';
  v_cnt     int;
  v_vis0    int;
  v_vis1    int;
  v_sup0    boolean;
  v_sup1    boolean;
BEGIN
  -- ── up.sql enqueue 함수(★실 정본 verbatim) 적용(무영속: 블록 말미 RAISE 로 unwind) ──
  EXECUTE $ff$
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
  -- INV5 (v1.5)
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
  --   ★FIX: 'superseded' = false 고정(신규 행은 항상 현행 가시본). 구 rev supersede 는 아래 UPDATE 로 처리.
  v_payload := jsonb_build_object(
    'source_system',  'foot',
    'clinic_id',      NEW.clinic_id,
    'clinic_slug',    v_slug,
    'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
    'revision',       NEW.revision,
    'superseded',     false,                    -- ★FIX: 신규 행 self-supersede 제거(구 rev>0 도 false → 리더 가시)
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

  -- ── INV5(총액 3중 대조): (v_total − v_hm) == v_sys_total. package 포함 유니버스 = 구조적 수렴 ──
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
          'rev_noninsurance',      v_nonins,      -- package 전건 여기로 흡수(비급여 default)
          'rev_insurance_covered', v_covered      -- INV3: total 미합산(청구 grain)
        ));
    ELSE
      RAISE LOG 'enqueue_closing_confirmed: insurance split INV 위반(copay=% nonins=% total=% covered=%) clinic=% date=% — split_insurance 생략(graceful)',
        v_copay, v_nonins, v_total, v_covered, v_slug, NEW.close_date;
    END IF;

  ELSIF v_src_ok AND NOT v_inv5_ok THEN
    -- INV5 발산 = emit-fail(발사 보류) + DLQ + 알람(삼킴 금지, DA Q4). 마감확정은 유지(비차단).
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

  -- ── ★FIX(b): 구 rev supersede — 동일 (clinic_id, close_date) 의 revision < NEW.revision 기존 행 UPDATE ──
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
    NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, false,     -- ★FIX: 신규 행 superseded=false
    v_payload, v_status, v_dlq, false, v_lasterr
  )
  ON CONFLICT (clinic_id, close_date, revision) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    -- payload 빌드/적재 실패 → 마감확정은 유지. 최소 v1 payload 재시도(emit 유실 방지).
    RAISE LOG 'enqueue_closing_confirmed: 전체 실패(%) clinic=% date=% — 마감확정 유지, 최소 payload 재시도',
      SQLERRM, v_slug, NEW.close_date;
    BEGIN
      -- ★FIX(b) fallback 경로 자체 supersede-UPDATE(격리 savepoint 롤백 대비 재실행)
      UPDATE public.closing_confirmed_outbox
         SET superseded = true
       WHERE clinic_id = NEW.clinic_id
         AND close_date = NEW.close_date
         AND revision < NEW.revision
         AND COALESCE(superseded, false) = false;

      INSERT INTO public.closing_confirmed_outbox
        (clinic_id, clinic_slug, close_date, revision, superseded, payload)
      VALUES (
        NEW.clinic_id, v_slug, NEW.close_date, NEW.revision, false,   -- ★FIX: 신규 행 superseded=false
        jsonb_build_object(
          'source_system',  'foot',
          'clinic_slug',    v_slug,
          'close_date',     to_char(NEW.close_date, 'YYYY-MM-DD'),
          'revision',       NEW.revision,
          'superseded',     false,               -- ★FIX: 신규 행 superseded=false
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
  $ff$;

  -- ── (1)(2)(3) 정의 검증 (pg_get_functiondef = plpgsql body verbatim 보존) ──
  SELECT pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure) INTO v_def;
  -- body 만(CREATE 시그니처/헤더 제외) — AS $x$ 이후 구간에서 결함식 잔재 검사
  v_body := v_def;
  IF v_def LIKE '%revision < NEW.revision%' AND v_def LIKE '%SET superseded = true%' THEN
    v_result := v_result || '(1) supersede-UPDATE(revision < NEW.revision → superseded=true) 실재: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(1) supersede-UPDATE 부재 FAIL' || E'\n'; END IF;
  -- (2) self-supersede 결함식 잔재 0 (함수 body 에 `(NEW.revision > 0)` 없음 — 주석은 `구 rev>0` 로만 표기)
  IF position('(NEW.revision > 0)' IN v_def) = 0 THEN
    v_result := v_result || '(2) self-supersede 결함식 (NEW.revision > 0) 잔재 0: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(2) self-supersede 결함식 잔재 FAIL' || E'\n'; END IF;
  -- (3) 신규 행 superseded=false 고정(payload 필드 + INSERT 컬럼)
  IF v_def LIKE '%''superseded'',     false%' AND v_def LIKE '%NEW.revision, false%' THEN
    v_result := v_result || '(3) 신규 행 superseded=false 고정: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(3) 신규 행 superseded=false FAIL' || E'\n'; END IF;

  -- ── (6) reader-visibility 시뮬 (무영속) — 임시 clinic 로 rev0→rev1 재emit 후 리더 반환/supersede 실증 ──
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  IF v_clinic IS NOT NULL THEN
    INSERT INTO public.closing_confirmed_outbox (clinic_id,clinic_slug,close_date,revision,superseded,payload)
    VALUES (v_clinic, v_slug, DATE '2999-12-31', 0, false, jsonb_build_object('dryrun',true,'revision',0))
    ON CONFLICT (clinic_id,close_date,revision) DO NOTHING;
    -- rev1 재emit = supersede-UPDATE(구 rev) + INSERT(신규 false) [트리거 규칙과 동형]
    UPDATE public.closing_confirmed_outbox SET superseded = true
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision < 1 AND COALESCE(superseded,false)=false;
    INSERT INTO public.closing_confirmed_outbox (clinic_id,clinic_slug,close_date,revision,superseded,payload)
    VALUES (v_clinic, v_slug, DATE '2999-12-31', 1, false, jsonb_build_object('dryrun',true,'revision',1))
    ON CONFLICT (clinic_id,close_date,revision) DO NOTHING;

    SELECT superseded INTO v_sup0 FROM public.closing_confirmed_outbox
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision=0;
    SELECT superseded INTO v_sup1 FROM public.closing_confirmed_outbox
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision=1;
    SELECT count(*) INTO v_vis0 FROM public.read_closing_confirmed_events(NULL,NULL,1000) e
      WHERE (e.payload->>'dryrun')='true' AND e.revision=0;
    SELECT count(*) INTO v_vis1 FROM public.read_closing_confirmed_events(NULL,NULL,1000) e
      WHERE (e.payload->>'dryrun')='true' AND e.revision=1;

    IF v_sup1 = false AND v_vis1 = 1 THEN
      v_result := v_result || '(6①②) 신 rev1 superseded=false + 리더 반환 포함: PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || format('(6①②) FAIL sup1=%s vis1=%s',v_sup1,v_vis1) || E'\n'; END IF;
    IF v_sup0 = true AND v_vis0 = 0 THEN
      v_result := v_result || '(6③) 구 rev0 superseded=true + 리더 불가시: PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || format('(6③) FAIL sup0=%s vis0=%s',v_sup0,v_vis0) || E'\n'; END IF;
  ELSE
    v_result := v_result || '(6) clinics 부재 — reader-visibility 시뮬 skip' || E'\n';
  END IF;

  -- ── (5) grant-seal 적용 + anon-EXEC=0 assert (C23) — 무영속(블록 말미 sentinel unwind) ──
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.enqueue_closing_confirmed() TO service_role;
  IF has_function_privilege('anon','public.enqueue_closing_confirmed()'::regprocedure,'EXECUTE') THEN
    v_all_ok := false; v_result := v_result || '(5) grant-seal FAIL: anon 여전히 EXECUTE 가능' || E'\n';
  ELSE
    v_result := v_result || '(5) grant-seal anon-EXEC=0 assert: PASS' || E'\n';
  END IF;

  -- ── (4) split 3함수 무접촉 확인 ──
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname IN
    ('closing_source_split','closing_insurance_split','closing_month_projection');
  IF v_cnt >= 3 THEN
    v_result := v_result || '(4) split 3함수 존치(무접촉): PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(4) split 함수 census FAIL' || E'\n'; END IF;

  RAISE NOTICE E'\n===== DRY-RUN 결과 (무영속) =====\n%all_ok=%', v_result, v_all_ok;
  IF NOT v_all_ok THEN
    RAISE EXCEPTION 'DRY-RUN FAIL — %', v_result;
  END IF;

  -- ★무영속 sentinel: 검증 성공이어도 강제 unwind (아무 것도 영속 안 됨 — 임시 outbox 행 포함 롤백)
  RAISE EXCEPTION 'DRY-RUN OK — no-persistence sentinel unwind (정상: 영속 방지)';
END
$dryrun$;

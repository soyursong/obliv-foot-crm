-- T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (FIX-REQUEST MSG-20260804-195718-bxx1)
--   결함명: reemit_self_supersede_reader_invisible (supersede 방향 완전 역전)
--
-- ─── 무엇 (변경의 전부: enqueue_closing_confirmed 1함수만) ────────────────────────────
--   배포된 20260804170000 마이그의 enqueue_closing_confirmed 가 신규 outbox 행의 superseded 를
--   `(NEW.revision > 0)` 로 세팅 → rev≥1(재emit) 신규 행이 자기 자신을 superseded=true 로 마킹.
--   구본(rev0)은 superseded=false 로 잔존 → supersede 방향 완전 역전.
--   리더 RPC read_closing_confirmed_events 는 `WHERE dlq=false AND COALESCE(superseded,false)=false`
--   → rev1 신규 행이 구조적으로 영구 불가시(리더가 절대 못 읽음). foot enabled=true 인데 발송 0.
--   ★prod 실측(supervisor, 2026-08-04):
--     08-01: rev0 total=0(틀린본) superseded=FALSE / rev1 total=11,353,900(정정본) superseded=TRUE
--     08-03: rev0 total=0(틀린본) superseded=FALSE / rev1 total=17,964,200(정정본) superseded=TRUE
--     → 틀린 rev0 이 가시본으로 잔존(의미 역전). cold-start 시 오발송 표면(dedup=2차 방어일 뿐).
--
-- ─── 수정 (FIX-REQUEST item 1) ─────────────────────────────────────────────────────
--   (a) 신규 행 superseded = false 고정 (payload 필드 + outbox INSERT 컬럼 + 최소-payload fallback 전건).
--   (b) 동일 (clinic_id, close_date) 의 revision < NEW.revision 기존 outbox 행 UPDATE superseded=true.
--       → 신규 rev 가 리더 가시본이 되고, 구 rev 전건이 superseded=true 로 수렴. supersede 방향 정상화.
--       ★UPDATE 는 각 INSERT 직전에 동일 plpgsql 블록 내에서 실행 → 예외격리 savepoint 하에서도
--         UPDATE+INSERT 원자성 보장(main 경로 / degraded fallback 경로 각각 자체 UPDATE 동봉).
--   ★outbox 직접 UPDATE 우회 아님 = 정당경로(enqueue 트리거 내 supersede 규칙). 원장 mutation 0.
--
-- ─── 불변(이 마이그가 건드리지 않는 것) ───────────────────────────────────────────────
--   • split 3함수(closing_source_split / closing_insurance_split / closing_month_projection) = 20260804170000
--     package-reconcile 정본 그대로. 본 마이그 무접촉(회귀 0).
--   • enqueue 의 나머지 로직(INV1/INV5 self-test·schema_version 2·DLQ·안전계약 예외격리) = 170000 정본 유지.
--     변경점은 superseded 값 산식 + supersede-UPDATE 2줄뿐(surgical).
--   • 윈도잉·유니버스·grant-seal(C23 backend-only 봉인) 전부 170000 계승.
--
-- change-class = ADDITIVE/CORRECTIVE (CREATE OR REPLACE FUNCTION 1건·시그니처 불변·파괴 스키마 0·
--   원장 mutation 0·롤백 대칭). → autonomy §3.1 대표게이트 면제. 잔여 = supervisor DDL/function-diff + MIG-GATE.
--
-- ─── C23-1 intended-caller-tier 선언 (SECDEF grant-seal, §15-5-10) ─────────────────
--   enqueue_closing_confirmed() = 트리거 함수(직접 RPC 호출부 grep 0건) → backend-only.
--   CREATE OR REPLACE 는 기존 ACL 보존하나, Supabase default 재부여 위험 대비 하단 §Y 로 per-fn 봉인 재동봉
--   (REVOKE PUBLIC/anon/authenticated + GRANT service_role). ★현행 seal 유지·PUBLIC 재개방 금지(FIX item 1c).
--   blanket ALTER DEFAULT PRIVILEGES 금지(C23-4).
--
-- C10 pre-apply baseline: 현행 prod enqueue md5 = f0a0033a (20260804170000 apply본, 10:10).
-- 멱등: CREATE OR REPLACE(시그니처 불변) → DROP 불요·42P13 불가·즉시 역전. 테이블/데이터/스키마 변경 0.
-- rollback: 20260804200000_foot_closing_reemit_supersede_fix.rollback.sql (170000 self-supersede 정본 복원·grant-seal 유지)
-- dryrun  : 20260804200000_foot_closing_reemit_supersede_fix.dryrun.sql (No-Persistence sentinel)
-- 작성: dev-foot / 2026-08-04

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- enqueue_closing_confirmed — supersede 방향 정상화 (신규=false 고정 + 구 rev UPDATE superseded=true)
--   ★변경점만: (1) payload 'superseded' → false  (2) 각 INSERT 직전 supersede-UPDATE  (3) INSERT superseded 컬럼 → false
--   나머지(INV1/INV5 self-test·schema_version 2·DLQ·안전계약)는 20260804170000 정본 그대로.
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

COMMENT ON FUNCTION public.enqueue_closing_confirmed() IS
  'T-CLOSING-HERALD: 확정 전이(open→closed) → payload(schema_version 2) 빌드 + INV1~5 self-test → outbox 적재. '
  '★FIX(reemit_self_supersede): 신규 행 superseded=false 고정 + 동일(clinic,close_date) revision<NEW.revision '
  '기존 행 UPDATE superseded=true (supersede 방향 정상화·리더 가시 보장). '
  'total_amount_krw·split = payments + package_payments · INV5(총액 3중 대조) 하드 게이트·발산 시 emit-fail+DLQ. '
  'source 실패→v1 / insurance 실패→graceful 생략. 마감확정 절대 비차단. clinic_slug 필수. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재 (트리거 재생성 불요, 함수만 교체)

-- ══════════════════════════════════════════════════════════════════
-- Y) SECURITY DEFINER grant-seal (C23 · §15-5-10) — enqueue backend-only 봉인 재동봉
--    ★현행 seal 유지·PUBLIC 재개방 금지(FIX item 1c). CREATE OR REPLACE default 재부여 대비 재봉인.
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

-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260812180000_foot_closing_enqueue_divergence_loudfail
-- Ticket: T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT (P1)
-- SSOT: agents/docs/da_replies/da_decision_foot_closing_herald_emit_timing_drift_reemit_20260812.md
--   verdict = CONDITIONAL-GO(병행) · Axis-A primary=dev-meta(테스트 prod-write-ban) ·
--             Axis-B(supersede 재정의)=REJECT · **Axis-B-narrow(divergence-aware loud-fail)=RECOMMENDED**
--   본 마이그 = foot lane 中 **Axis-B-narrow 단독**(enqueue 1함수 CREATE OR REPLACE · function-diff).
--
-- ── 무엇 (변경의 전부: enqueue_closing_confirmed 의 primary ON CONFLICT 처리 1지점) ─────────
--   현행 prod(20260806150000, TOTALS-RECOMPUTE-PORT) 의 enqueue 는 outbox INSERT 를
--     `ON CONFLICT (clinic_id, close_date, revision) DO NOTHING` 으로 처리 → composite key 충돌 시 **silent-drop**.
--   RC(dev-foot firsthand, write/DDL 0): E2E CF-5 spec 이 PROD 에 가짜 closed dc(single_card=80,000,
--   memo='CF-5 자동 마감 spec') INSERT → outbox rev0 슬롯 선점(phantom 80k). 이후 실 EOD 마감(rev0)의
--   정상 emit 이 이 DO NOTHING 으로 **조용히 드롭** → stale phantom 80k 만 reader-visible(08-07~08-11 발산).
--
-- ── 처방 (DA Q1 B-narrow · §49~51 · cross_crm_write_rowcheck_standard "Silent Write-Failure 금지") ──────
--   DO NOTHING 을 silent → **divergence-aware** 로만 강화(계약 재정의 아님·supersede 아님):
--     · composite key 충돌 시 stored slot payload 와 incoming 실 payload 를 **INV5 축**
--       (total_amount_krw / daily_closings 확정합=Σsystem_totals) 으로 대조.
--     · **identical(진성 멱등 재시도) → true no-op** (DO NOTHING 그대로 · idempotency 불변).
--     · **material 상이(phantom-collision) → silent-drop 금지 → RAISE WARNING(loud-fail, 표면화)**.
--   ★H7 준수: **mutate-on-conflict 아님** — stored 행을 UPDATE/supersede 하지 않는다(순수 표면화). RAISE WARNING
--     (NOT EXCEPTION) → 트랜잭션 abort 없음 → 마감확정(open→closed) **절대 비차단**(안전계약 유지).
--   ★DA Q1 (B) supersede+rev bump 재정의는 REJECT-as-mechanism → 본 마이그는 그것을 구현하지 않는다.
--   ★INV5(§3 payload-time 3중 대조)의 enqueue-time 자연 확장 = phantom 80k 가 daily_closings 확정합과
--     불일치하는 정확히 그 divergence 클래스를 표면화.
--
-- ── 불변(이 마이그가 건드리지 않는 것) ───────────────────────────────────────────────────
--   • total_amount_krw·totals·system_totals·INV1~5 산식 = 20260806150000(TOTALS-RECOMPUTE-PORT) 정본 그대로.
--   • split 3함수(closing_source_split / closing_insurance_split / closing_month_projection) = 무접촉(회귀 0).
--   • 200000 supersede-fix 계승(신규 superseded=false + 구 rev supersede UPDATE) = 유지.
--   • degraded fallback INSERT(예외 격리 최소-payload 재시도) = plain DO NOTHING 유지(divergence 대조 대상 아님·
--     degraded payload 에는 INV5 축 필드가 없어 대조 무의미 · last-ditch emit-loss-prevention 경로).
--   • grant-seal(C23 backend-only) 전부 계승.
--   변경점 = primary INSERT 뒤 GET DIAGNOSTICS + divergence 대조 블록 (+ DECLARE 3변수). surgical.
--
-- change-class = ADDITIVE/CORRECTIVE (CREATE OR REPLACE FUNCTION 1건·시그니처 불변·파괴 스키마 0·
--   테이블/데이터/컬럼 변경 0·원장 mutation 0·롤백 대칭). → 그러나 **DDL(function) + revenue-adjacent** →
--   §3.1 대표게이트(파괴)는 면제이나 **DDL-0 carve 아님** → supervisor DDL-diff / MIG-GATE + **물리 GO-token 선행 REQUIRED**.
--   ('DDL 0'≠GO-token 면제 — DA §110/§128 명시. 본 마이그는 DDL 실재.)
--
-- ── C23-1 intended-caller-tier 선언 (SECDEF grant-seal, §15-5-10) ─────────────────────────
--   enqueue_closing_confirmed() = 트리거 함수(직접 RPC 호출부 grep 0건) → backend-only.
--   CREATE OR REPLACE default 재부여 대비 하단 §Y 로 재봉인(REVOKE PUBLIC/anon/authenticated + GRANT service_role + assert).
--
-- C10 pre-apply baseline: 현행 prod enqueue 정본 = 20260806150000(marker 'TOTALS-RECOMPUTE-PORT').
-- 멱등: CREATE OR REPLACE(시그니처 불변) → DROP 불요·42P13 불가·즉시 역전. 테이블/데이터/스키마 변경 0.
-- rollback: 20260812180000_foot_closing_enqueue_divergence_loudfail.rollback.sql (806150000 정본 verbatim 복원)
-- dryrun  : 20260812180000_foot_closing_enqueue_divergence_loudfail.dryrun.mjs (No-Persistence sentinel + marker post-probe)
-- 작성: dev-foot / 2026-08-12 · write 0 until supervisor 물리 GO-token
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- enqueue_closing_confirmed — 20260806150000 정본 verbatim + B-narrow divergence-aware loud-fail(primary ON CONFLICT)
--   ★변경점만: (1) DECLARE v_ins_rows/v_stored/v_stored_sys  (2) primary INSERT 뒤 GET DIAGNOSTICS + divergence 대조
--   나머지(TOTALS-RECOMPUTE-PORT 산식·INV1~5·supersede-UPDATE·안전계약·degraded fallback)는 806150000 정본 그대로.
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
  -- ★B-narrow(divergence-aware loud-fail): composite-key 충돌 표면화용 (mutate 아님)
  v_ins_rows  INT := 0;
  v_stored    JSONB;
  v_stored_sys BIGINT;
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

  -- ── ★B-narrow DIVERGENCE-LOUDFAIL (DA Q1 §49~51 · cross_crm_write_rowcheck_standard "Silent Write-Failure 금지") ──
  --   composite key 충돌(= INSERT 0행)이면 stored slot 과 incoming 실 payload 를 INV5 축으로 대조.
  --   ★identical(진성 멱등 재시도) = true no-op / material 상이(phantom-collision) = RAISE WARNING(loud-fail·표면화만).
  --   ★H7: mutate-on-conflict 아님 — stored 행 UPDATE/supersede 0. RAISE WARNING(NOT EXCEPTION) → 마감확정 비차단.
  GET DIAGNOSTICS v_ins_rows = ROW_COUNT;
  IF v_ins_rows = 0 THEN
    SELECT o.payload INTO v_stored
      FROM public.closing_confirmed_outbox o
     WHERE o.clinic_id = NEW.clinic_id
       AND o.close_date = NEW.close_date
       AND o.revision = NEW.revision;
    IF v_stored IS NOT NULL THEN
      -- stored slot 의 daily_closings 확정합(Σsystem_totals) 재구성
      v_stored_sys := COALESCE((v_stored -> 'system_totals' ->> 'card')::BIGINT, 0)
                    + COALESCE((v_stored -> 'system_totals' ->> 'cash')::BIGINT, 0)
                    + COALESCE((v_stored -> 'system_totals' ->> 'bank_transfer')::BIGINT, 0)
                    + COALESCE((v_stored -> 'system_totals' ->> 'other')::BIGINT, 0);
      -- INV5 축 divergence: (a) total_amount_krw  또는  (b) daily_closings 확정합(Σsystem_totals) 이 material 상이
      IF ( (v_stored ->> 'total_amount_krw') IS DISTINCT FROM (v_payload ->> 'total_amount_krw') )
         OR ( v_stored_sys IS DISTINCT FROM v_sys_total ) THEN
        RAISE WARNING 'enqueue_closing_confirmed: CLOSING-HERALD-DIVERGENCE-LOUDFAIL phantom-collision(silent-drop 금지, INV5축) — stored(total_amount_krw=%, Σsystem_totals=%) <> incoming(total_amount_krw=%, daily_closings 확정합=%) clinic=% slug=% date=% rev=% (no-mutate·no-supersede·표면화만; Q3 정정 대상 후보)',
          (v_stored ->> 'total_amount_krw'), v_stored_sys,
          (v_payload ->> 'total_amount_krw'), v_sys_total,
          NEW.clinic_id, v_slug, NEW.close_date, NEW.revision;
      -- identical → true no-op(진성 멱등 재시도): 로그 침묵(정상 거동)
      END IF;
    END IF;
  END IF;

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

      -- ★degraded fallback = plain DO NOTHING 유지(divergence 대조 대상 아님: 최소-payload 에 INV5 축 필드 부재).
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
  'T-CLOSING-HERALD(foot) v1.8 DIVERGENCE-LOUDFAIL: 20260806150000 TOTALS-RECOMPUTE-PORT 정본 + B-narrow. '
  'primary ON CONFLICT 충돌 시 stored↔incoming 을 INV5 축(total_amount_krw / daily_closings 확정합) 대조 — '
  'identical=true no-op / material 상이=RAISE WARNING(loud-fail·표면화·no-mutate·no-supersede·H7). '
  '(B) supersede+rev bump 재정의 아님(DA REJECT). degraded fallback=plain DO NOTHING 유지. '
  'total_amount_krw=daily_closings 확정 구성분·INV5 하드 게이트·발산 시 emit-fail+DLQ·마감확정 절대 비차단. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재 (트리거 재생성 불요, 함수만 교체)

-- ══════════════════════════════════════════════════════════════════
-- Y) SECURITY DEFINER grant-seal (C23 · §15-5-10) — enqueue backend-only 봉인 재동봉
--    ★CREATE OR REPLACE default 재부여 대비. intended-caller-tier = backend-only(트리거 · grep 0건).
--    split 3함수는 본 마이그 무접촉 → 재봉인 대상 아님(806150000 seal 유지).
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

-- ══════════════════════════════════════════════════════════════════
-- 적용시점 self-test (실패 시 EXCEPTION → 배포 중단) — DIVERGENCE-LOUDFAIL 실증 + 806150000 회귀가드
-- ══════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure) INTO v_def;

  -- (1) ★B-narrow divergence loud-fail 실재 — 신 마커 + RAISE WARNING + GET DIAGNOSTICS(ROW_COUNT) 존재
  IF v_def !~ 'CLOSING-HERALD-DIVERGENCE-LOUDFAIL' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: enqueue 에 divergence loud-fail 마커 부재 — B-narrow 미착지.';
  END IF;
  IF v_def !~ 'GET DIAGNOSTICS' OR v_def !~ 'v_ins_rows' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: enqueue 에 GET DIAGNOSTICS/v_ins_rows(충돌 감지) 부재 — divergence 대조 미구현.';
  END IF;
  -- (2) ★H7 mutate-on-conflict 아님 — divergence 대조 블록이 stored 를 UPDATE 하지 않음(supersede 재정의 REJECT).
  --     conflict-처리에 supersede+rev bump 재정의 잔재 0. (구 rev supersede-UPDATE 는 정당 계승이므로 별도 assert (6)에서 유지 확인)
  IF v_def ~ 'ON CONFLICT[^;]*DO UPDATE' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: ON CONFLICT DO UPDATE(mutate-on-conflict) 잔존 — DA (B) REJECT/H7 위반.';
  END IF;
  -- (3) ★TOTALS-RECOMPUTE-PORT 정본 계승 — 확정 구성분 recompute(v_sys_card/v_sys_cash/v_sys_total) 유지
  IF v_def !~ 'v_sys_card' OR v_def !~ 'v_sys_cash' OR v_def !~ 'v_sys_total' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: 확정 구성분 recompute 부재 — 806150000 회귀.';
  END IF;
  -- (4) ★stale actual_* 폐기 유지
  IF v_def ~ 'actual_card_total' OR v_def ~ 'actual_cash_total' OR v_def ~ 'actual_transfer_total' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: stale actual_* 잔재 — 806150000 회귀.';
  END IF;
  -- (5) ★INV5 hm −보정 제거 유지
  IF v_def ~ 'health_maintenance' OR v_def ~ 'v_hm' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: health_maintenance/v_hm 잔재 — 806150000 회귀.';
  END IF;
  -- (6) ★200000 supersede-fix 계승 — 구 revision supersede UPDATE 실재 + self-supersede 역전 패턴 0
  IF v_def !~ 'revision\s*<\s*NEW\.revision' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: 구 revision supersede UPDATE 부재 — 200000/806150000 회귀.';
  END IF;
  IF position('(NEW.revision > 0)' IN v_def) <> 0 THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: self-supersede 역전 패턴 잔존 — 200000 회귀.';
  END IF;
  -- (7) ★INV5 게이트 유지
  IF v_def !~ 'v_inv5_ok' THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: INV5 게이트 부재(회귀).';
  END IF;
  -- (8) ★C23 grant-seal 실증: enqueue anon EXECUTE 잔존 시 배포 중단
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'DIVERGENCE-LOUDFAIL: C23 grant-seal 미결착 — enqueue anon EXECUTE 잔존.';
  END IF;
  RAISE NOTICE 'DIVERGENCE-LOUDFAIL self-test 통과 (B-narrow loud-fail 착지 · mutate-on-conflict 0 · 806150000 산식 계승 · supersede 유지 · INV5 유지 · C23 seal)';
END
$verify$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple
-- Ticket: T-20260813-foot-CLOSING-HERALD-INV1-SPLITSIGN-GUARD-DECOUPLE (P2, approved)
-- SSOT(canonical fix): T-20260813-scalp2-CLOSING-HERALD-INV1-SPLITSIGN-GUARD-DECOUPLE
--   (20261106000000_scalp2_closing_enqueue_inv1_splitsign_guard_decouple.sql · 20261106 패턴 재사용)
-- 자매(cross-fork census): T-20260813-xcrm-CLOSING-ENQUEUE-SPLITSIGN-GUARD-CENSUS (planner · supervisor QA GO Green,
--   독립 재실측 5/5 일치 → foot leg COUPLED 확정. scalp2 08-05 RC 동형.)
-- 현행 prod 정본(C10 baseline): 20260806150000_foot_closing_herald_totals_recompute_port (marker 'TOTALS-RECOMPUTE-PORT'·v_src_ok 부호결합)
--
-- ── RC (scalp2 08-05 RC 동형 · cross-fork COUPLED) ───────────────────────────
--   마감전령 enqueue payload-build 의 source-split 非음수 guard(현행 20260806150000 L398-400 `v_src_ok` 의
--   `v_ad>=0 AND v_org>=0`)가 total_amount_krw(L410) 발사를 split-sign 에 fatal-couple.
--   정당한 음수 광고매출(환불 우세일 = 前일 광고매출 당일 환불 = 정당 cross-day 회계)이 발생하면 v_src_ok=FALSE →
--   INV5-검증된 known-correct total 마저 차단 → sv1/NULL degraded.
--   ★비대칭: split_insurance 는 graceful-omit(생략만) 되나 split_source 는 total 까지 fatal.
--
-- ── 처방 (canonical 해소 · scalp2 시그니처 준수 · 발명 금지 · surgical) ──────────
--   total 발사를 **INV5 + INV1-sum(ad+org==total)** 에만 게이트, **split-sign(v_ad>=0/v_org>=0) 에서 DECOUPLE**.
--   변경점 (enqueue 유입경로축 split_source 블록 내부 3 지점 + DECLARE 2변수 교체):
--     (1) v_src_ok(합+부호 결합) → v_inv1_sum_ok(합만·total 게이트) ⊥ v_split_sign_ok(부호만·split_source 탑재 게이트) 로 직교 분해.
--     (2) `IF v_src_ok AND v_inv5_ok` → `IF v_inv1_sum_ok AND v_inv5_ok` → 통과 시 schema_version 2 + total_amount_krw **무조건** 탑재.
--         split_source = v_split_sign_ok 시 탑재 / 음수(정당 cross-day 환불) 시 **graceful-omit**(split_insurance 미러) + RAISE LOG. total 은 이미 발사됨.
--         → split_source 처분 = scalp2 canonical 택1 中 (b) graceful-omit(split_insurance 미러) 채택(비대칭의 대칭화·최저 리스크·시그니처 준수).
--     (3) `ELSIF v_src_ok AND NOT v_inv5_ok`(INV5 발산 DLQ) → `ELSIF v_inv1_sum_ok AND NOT v_inv5_ok` (부호 무관·진성 money divergence 만 DLQ).
--         최종 ELSE = INV1-sum 위반(ad+org<>total = 진성 금액 불일치·부호 문제 아님) → split/total 생략, schema_version=1.
--
-- ── 불변 (이 마이그가 건드리지 않는 것 · 회귀 0) ──────────────────────────────
--   • 20260806150000 TOTALS-RECOMPUTE-PORT 산식 verbatim 계승: total=daily_closings 확정 구성분(package_*+single_* by method,
--     v_sys_card/v_sys_cash/v_sys_transfer/v_sys_total recompute)·totals=system_totals(stale actual_* 폐기)·hm −보정 제거.
--   • foot DLQ 기제(v_status/v_dlq/v_lasterr + inv5_divergence payload + status/dlq/dlq_alerted/last_error 컬럼 INSERT) verbatim 계승.
--   • 200000 supersede-fix(신 행 superseded=false + 구 rev(revision<NEW) supersede UPDATE)·안전계약(EXCEPTION 격리·마감 비차단)·
--     degraded 최소 payload fallback·source_system='foot'·grant-seal = 그대로.
--   • closing_source_split / closing_insurance_split / closing_month_projection 3함수 = 무접촉(이 마이그는 enqueue 만 CREATE OR REPLACE).
--   • money data(payments/package_payments/daily_closings/closing_confirmed_outbox rows) **물리 무접촉**(발명 금지·시그니처/컬럼/데이터 불변).
--   변경점 = enqueue split_source 블록 내부 3 지점 + DECLARE(v_src_ok → v_inv1_sum_ok + v_split_sign_ok). surgical.
--
-- change-class = ADDITIVE/CORRECTIVE (CREATE OR REPLACE FUNCTION 1건·시그니처 불변·파괴 스키마 0·테이블/데이터/컬럼 변경 0·
--   롤백 대칭). guard 완화(total 무조건 발사·데이터 무변경) = ADDITIVE 성격. 신규 컬럼/테이블/enum 0 → §S2.4 DA CONSULT 불요.
--   → DDL(function) + revenue-adjacent → §3.1 대표게이트(파괴) 면제이나 DDL-0 carve 아님 →
--     supervisor DDL-diff / MIG-GATE(billing-invariant oracle) + 물리 GO-token 선행 REQUIRED('DDL 0'≠GO-token 면제·apply_before_go 금지).
--
-- ── C23-1 intended-caller-tier 선언 (SECDEF grant-seal, §15-5-10) ─────────────
--   enqueue_closing_confirmed() = 트리거 함수(직접 RPC 호출부 grep 0건) → backend-only. CREATE OR REPLACE default 재부여 대비 §Y 로 재봉인.
--
-- MIG-SCOPE(§13.1.C) — same-(domain=foot, fn=enqueue) 이중 authoring. C10/C19 baseline = 20260806150000 apply본 enqueue prosrc.
-- 멱등: CREATE OR REPLACE(시그니처 불변) → DROP 불요·42P13 불가·즉시 역전. 테이블/데이터/스키마 변경 0.
-- rollback: 20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.rollback.sql (20260806150000 enqueue 정본 verbatim 복원·대칭)
-- dryrun  : 20260813120000_foot_closing_enqueue_inv1_splitsign_guard_decouple.dryrun.mjs (No-Persistence sentinel + assertAbsent 신마커)
-- prod apply = supervisor 전속(herald 계열). dev-foot = dry-run 무영속 + rollback 대칭 + deploy-ready. write 0 until supervisor 물리 GO-token(HOLD-until-GO).
-- 마커: 'INV1-SPLITSIGN-DECOUPLE' (assertAbsent 무영속 실증용).
-- 작성: dev-foot / 2026-08-13
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- enqueue_closing_confirmed — 20260806150000 TOTALS-RECOMPUTE-PORT 정본 + INV1-SPLITSIGN-DECOUPLE
--   ★변경점만: v_src_ok → v_inv1_sum_ok(합·total 게이트) ⊥ v_split_sign_ok(부호·split_source 탑재 게이트) ·
--     total_amount_krw 무조건 발사 · split_source graceful-omit(음수 시). 나머지(TOTALS-RECOMPUTE-PORT 산식·
--     foot DLQ 기제·supersede·안전계약·source_system=foot)는 정본 그대로.
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
  -- ★INV1-SPLITSIGN-DECOUPLE: 합(total 게이트) ⊥ 부호(split_source 탑재 게이트) 직교 분해
  v_inv1_sum_ok   BOOLEAN := false;  -- INV1 항등: ad+org==total (total_amount_krw 발사 게이트 · INV5 와 결합)
  v_split_sign_ok BOOLEAN := false;  -- split-sign: ad>=0 AND org>=0 (split_source 탑재 여부만 게이트 · total 과 DECOUPLE)
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

  -- ── 유입경로축 split_source (INV1-SPLITSIGN-DECOUPLE) — daily_closings authority ──
  --   ★합(v_inv1_sum_ok) = total_amount_krw 발사 게이트(INV5 와 결합) · 부호(v_split_sign_ok) = split_source 탑재 여부만 게이트(total 과 DECOUPLE).
  --   음수 광고매출(정당 cross-day 환불 회계)은 INV5-검증된 known-correct total 발사를 **차단하지 않는다**.
  v_src   := public.closing_source_split(NEW.clinic_id, NEW.close_date);
  v_total := (v_src ->> 'total')::BIGINT;               -- = daily_closings sys_total(함수 read) — v_sys_total 과 대조
  v_ad    := (v_src ->> 'revenue_ad')::BIGINT;
  v_org   := (v_src ->> 'revenue_organic')::BIGINT;
  -- INV1 항등(합): ad+org==total — total 발사 게이트(금액 정합). 부호와 무관.
  v_inv1_sum_ok := (v_total IS NOT NULL)
                   AND (COALESCE(v_ad,0) + COALESCE(v_org,0) = v_total);
  -- split-sign(비음수): ad>=0 AND org>=0 — split_source 탑재 여부만 게이트. total 과 DECOUPLE.
  v_split_sign_ok := (COALESCE(v_ad,0) >= 0) AND (COALESCE(v_org,0) >= 0);

  -- ── ★INV5(총액 3중 대조): v_total(함수 daily_closings read) == v_sys_total(트리거 NEW 컬럼) == Σsystem_totals ──
  --    세 항 동일 확정 구성분 파생 → 구조적 수렴. hm −보정 제거(총액 = 4버킷 컬럼 = hm 밖).
  v_inv5_ok := (v_total IS NOT NULL) AND (v_total = v_sys_total);

  IF v_inv1_sum_ok AND v_inv5_ok THEN
    -- INV1-sum + INV5 통과 → schema_version 2 + total_amount_krw(= 권위 확정합) **무조건** 탑재(split-sign 무관·DECOUPLE).
    v_payload := v_payload
      || jsonb_build_object('schema_version', 2)
      || jsonb_build_object('total_amount_krw', v_total);

    -- split_source: 비음수 → 탑재 / 음수(정당 cross-day 환불) → graceful-omit(split_insurance 미러). total 은 이미 발사됨.
    IF v_split_sign_ok THEN
      v_payload := v_payload
        || jsonb_build_object('split_source',
             jsonb_build_object('revenue_ad', v_ad, 'revenue_organic', v_org));
    ELSE
      RAISE LOG 'enqueue_closing_confirmed: split_source 非음수 guard 위반(정당 음수 광고매출=cross-day 환불 회계: ad=% org=% total=%) clinic=% date=% — split_source 생략(graceful·split_insurance 미러), total_amount_krw=% 무조건 발사(DECOUPLE)',
        v_ad, v_org, v_total, v_slug, NEW.close_date, v_total;
    END IF;

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

  ELSIF v_inv1_sum_ok AND NOT v_inv5_ok THEN
    -- ★INV5 발산(진성 money divergence·부호 무관) = emit-fail(발사 보류) + DLQ + 알람(삼킴 금지, DA Q4). 마감확정은 유지(비차단).
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
    -- source INV1-sum 위반(ad+org<>total = 진성 금액 불일치·부호 문제 아님) → split 신뢰불가 → schema_version 1 발사(기존 거동)
    RAISE LOG 'enqueue_closing_confirmed: source split INV1-sum 위반(ad+org<>total: ad=% org=% total=%) clinic=% date=% — split 생략, schema_version=1 발사',
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
  'T-CLOSING-HERALD(foot) v1.7 INV1-SPLITSIGN-DECOUPLE: 20260806150000 TOTALS-RECOMPUTE-PORT 정본 + split-sign guard decouple. '
  'total_amount_krw 발사 = INV1-sum(ad+org==total) + INV5 에만 게이트(v_inv1_sum_ok AND v_inv5_ok). '
  'split-sign(ad>=0/org>=0 = v_split_sign_ok) 은 split_source 탑재 여부만 게이트(total 과 DECOUPLE) — '
  '음수 광고매출(정당 cross-day 환불 회계)은 known-correct total 발사를 차단하지 않고 split_source 만 graceful-omit(split_insurance 미러). '
  'total=daily_closings 확정 구성분(package_*+single_*, ledger net 폐기)·totals=system_totals recompute(stale actual_* 폐기)·'
  'INV5(v_total==v_sys_total==Σsystem_totals, hm 보정 제거) 하드 게이트·발산 시 emit-fail+DLQ(status/dlq/last_error). '
  '200000 supersede-fix(신 행 superseded=false + 구 rev UPDATE)·안전계약·degraded fallback·source_system=foot 계승. 마감확정 절대 비차단. 멱등 ON CONFLICT.';

-- confirm_guard(BEFORE)가 revision 확정 후 → enqueue(AFTER)가 최종 revision으로 적재 (트리거 재생성 불요, 함수만 교체)

-- ══════════════════════════════════════════════════════════════════
-- Y) SECURITY DEFINER grant-seal (C23 · §15-5-10) — enqueue backend-only 봉인 재동봉
--    ★CREATE OR REPLACE default 재부여 대비. intended-caller-tier = backend-only(트리거 · grep 0건).
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
-- 적용시점 self-test (실패 시 EXCEPTION → 배포 중단) — decouple 착지 실증 + TOTALS-RECOMPUTE-PORT/supersede 회귀가드
-- ══════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure) INTO v_def;

  -- (1) ★DECOUPLE 착지 — 합/부호 직교 분해 변수 실재 + total 게이트가 v_inv1_sum_ok AND v_inv5_ok
  IF v_def !~ 'v_inv1_sum_ok' OR v_def !~ 'v_split_sign_ok' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: v_inv1_sum_ok/v_split_sign_ok 부재 — 합/부호 직교 분해 미착지.';
  END IF;
  IF v_def !~ 'v_inv1_sum_ok\s+AND\s+v_inv5_ok' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: total 게이트가 (v_inv1_sum_ok AND v_inv5_ok) 아님 — decouple 미착지.';
  END IF;
  -- (2) ★결합결함 폐기 실증 — 구 v_src_ok(합+부호 결합) 잔재 0
  IF v_def ~ 'v_src_ok' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: 구 v_src_ok(합+부호 결합 guard) 잔존 — 결합결함 미폐기.';
  END IF;
  -- (3) ★total 무조건 발사 — total_amount_krw 탑재 존재(split_source 와 분리 · DECOUPLE)
  IF v_def !~ 'total_amount_krw' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: total_amount_krw 부재 — 발사 로직 소실.';
  END IF;
  -- (4) ★TOTALS-RECOMPUTE-PORT 산식 계승 — 확정 구성분 recompute(v_sys_card/v_sys_cash/v_sys_total) 실재
  IF v_def !~ 'v_sys_card' OR v_def !~ 'v_sys_cash' OR v_def !~ 'v_sys_total' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: 확정 구성분 recompute(v_sys_card/v_sys_cash/v_sys_total) 부재 — TOTALS-RECOMPUTE-PORT 회귀.';
  END IF;
  -- (5) ★stale actual_* 폐기 계승 — payload emit 소스에 actual_* 잔재 0
  IF v_def ~ 'actual_card_total' OR v_def ~ 'actual_cash_total' OR v_def ~ 'actual_transfer_total' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: stale actual_* 잔재 — TOTALS-RECOMPUTE-PORT DEPRECATE 회귀.';
  END IF;
  -- (6) ★hm −보정 제거 계승 — health_maintenance/v_hm 잔재 0
  IF v_def ~ 'health_maintenance' OR v_def ~ 'v_hm' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: health_maintenance/v_hm 잔재 — hm −보정 미제거 회귀.';
  END IF;
  -- (7) ★foot DLQ 기제 계승 — INV5 발산 status=failed/dlq/last_error + inv5_divergence
  IF v_def !~ 'inv5_divergence' OR v_def !~ 'v_dlq' OR v_def !~ 'v_status' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: foot DLQ 기제(inv5_divergence/v_dlq/v_status) 부재 — 회귀.';
  END IF;
  IF v_def !~ 'v_inv5_ok' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: INV5 게이트(v_inv5_ok) 부재 — 회귀.';
  END IF;
  -- (8) ★200000 supersede-fix 계승 — 구 revision supersede UPDATE + self-supersede 역전 폐기
  IF v_def !~ 'revision\s*<\s*NEW\.revision' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: 구 revision supersede UPDATE 부재 — 200000 fix 회귀.';
  END IF;
  IF position('(NEW.revision > 0)' IN v_def) <> 0 THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: self-supersede 역전 `(NEW.revision > 0)` 잔존 — 200000 회귀.';
  END IF;
  -- (9) ★source_system=foot 계승(도메인 격리 — scalp2 verbatim 오염 방지)
  IF v_def !~ '''foot''' THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: source_system=foot 부재 — 도메인 오염(scalp2 verbatim 잔재?).';
  END IF;
  -- (10) ★C23 grant-seal 실증: enqueue anon EXECUTE 잔존 시 배포 중단
  IF has_function_privilege('anon', 'public.enqueue_closing_confirmed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SPLITSIGN-DECOUPLE: C23 grant-seal 미결착 — enqueue anon EXECUTE 잔존.';
  END IF;
  RAISE NOTICE 'SPLITSIGN-DECOUPLE self-test 통과 (합/부호 직교 분해 · total 게이트=INV1-sum AND INV5 · v_src_ok 폐기 · split_source graceful-omit · TOTALS-RECOMPUTE-PORT/foot DLQ/supersede 계승 · source_system=foot · C23 seal)';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 사후 검증 (supervisor prod apply 후 · POSTCHECK):
--   1) 08-05 등 음수 광고매출(환불 우세)일 REEMIT → sv2 clean · total_amount_krw == daily_closings 확정합(± 0)
--      · INV5 pass(dlq=false) · split_source 는 음수 시 graceful-omit(키 부재) · total 은 발사됨.
--   2) 비음수 정상일(split_source 탑재) 회귀 0 — split_source{revenue_ad,revenue_organic} 탑재 + ad+org==total.
--   3) INV5 발산 시에만 status=failed·dlq=true (부호 무관·진성 money divergence). 부호 문제는 DLQ 아님.
--   4) 신행 superseded=false · 구 rev 전건 superseded=true.
--   5) daily_closings/payments/package_payments/closing_confirmed_outbox rows 물리 무변 — payload 산식 게이트만 접촉.
--   6) 3함수(source_split/insurance_split/month_projection) prosrc 무변(이 마이그 enqueue-only). 롱레/derm/scalp2 전령 무영향.
-- ────────────────────────────────────────────────────────────────────────────

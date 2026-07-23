-- T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC
-- ============================================================================
-- 풋센터 consumer RPC 신설 — cancel_reservation_from_source
--   parent T-20260723-dopamine-RESV-DELETE-ADMIN-BTN-CROSS-CRM(leg4 forward soft-cancel 전파)의
--   풋 착지(consumer half). sibling T-20260723-body-RESV-CANCEL-FROM-SOURCE-RPC 와 동형.
--
-- 계약(AC, body child 와 동형):
--   AC-1  도파민 emit 신호 수신 → 대응 풋 예약 soft-cancel (풋 lane 취소 시맨틱 = status='cancelled'
--         전이 + 슬롯 release. ★hard-DELETE 금지.)
--   AC-2  idempotent — 멱등키 (source_system='dopamine', external_id=cue_card_id). 중복/retry 1회만
--         실효(부재/이미 cancelled → 성공 no-op).
--   AC-3  fail-close 단방향 — source_system='dopamine' 만 수용(그 외 RAISE, 22023).
--   AC-4  하류상태 RESTRICT/ABORT — check_ins / payments / service_charges / medical_charts 존재 시
--         취소 거부 + 정합경고 반환(★순소실0: 아무 것도 변경하지 않음).
--   AC-5  rows-affected 검증(cross_crm_write_rowcheck_standard) — UPDATE 후 GET DIAGNOSTICS ROW_COUNT.
--         0-row 를 성공으로 오독 금지 → 사후 re-probe(실 status 재확인) 후 성공/실패 판별.
--
-- ★ foot lane 하류 결속(body 대비 명칭 divergence 없음 — 동형 확인):
--     check_ins.reservation_id → reservations(id)  (직결)
--     payments.check_in_id       → check_ins(id)     (경유)
--     service_charges.check_in_id→ check_ins(id)     (경유)
--     medical_charts.check_in_id → check_ins(id)     (경유, nullable FK / PHI)
--   → 예약 취소의 하류 게이트는 모두 check_ins(reservation_id) 스코프로 판정한다.
--     ⚠ medical_charts 는 PHI — 본 함수는 존재 COUNT 만 수행(행/컬럼 노출 0). supervisor PHI DB-GATE 인지용 명시.
--
-- ★ 게이트: ADDITIVE(신규 callable, 기존 오브젝트·데이터 무변경) → 대표게이트 면제. DA GO = parent 8fut G4
--   (forward soft-cancel 전파 설계, 소비자 lane 불문 동일) 계승 → 신규 DA CONSULT 불요. supervisor = DDL-diff.
--   MIG-GATE: db_change=true / e2e_spec_exempt_reason=db_only.
--
-- dryrun:   20260723200000_foot_cancel_reservation_from_source_rpc.dryrun.mjs (no-persistence)
-- rollback: 20260723200000_foot_cancel_reservation_from_source_rpc.rollback.sql (DROP FUNCTION)
-- author: dev-foot / 2026-07-23
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_reservation_from_source(
  p_source_system TEXT,
  p_external_id   TEXT,
  p_reason        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res_id     UUID;
  v_status     TEXT;
  v_rows       INT;
  v_checkins   INT := 0;
  v_payments   INT := 0;
  v_charges    INT := 0;
  v_medcharts  INT := 0;
  v_downstream INT := 0;
  v_reprobe    TEXT;
BEGIN
  -- ── AC-3 fail-close 단방향: source_system='dopamine' 만 수용 ──────────────────
  IF p_source_system IS NULL OR lower(btrim(p_source_system)) <> 'dopamine' THEN
    RAISE EXCEPTION
      'cancel_reservation_from_source: fail-close — only source_system=''dopamine'' accepted (got %)',
      p_source_system USING ERRCODE = '22023';
  END IF;
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'cancel_reservation_from_source: external_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- ── 대상 예약 조회 (self-mint scope guard: dopamine 이 mint 한 행만) ───────────
  --   split-brain 차단: foot-native(다른 source)/NULL source 행은 대상 아님.
  SELECT r.id, r.status
    INTO v_res_id, v_status
    FROM public.reservations r
   WHERE r.source_system IS NOT NULL
     AND lower(r.source_system) = 'dopamine'
     AND r.external_id = p_external_id
   LIMIT 1;

  -- ── AC-2 멱등: 대상 부재 → no-op 성공 (retry/중복 안전) ────────────────────────
  IF v_res_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'applied', false, 'action', 'noop_absent',
      'reservation_id', NULL, 'rows_affected', 0, 'external_id', p_external_id
    );
  END IF;

  -- ── AC-2 멱등: 이미 cancelled → no-op 성공 ────────────────────────────────────
  IF lower(COALESCE(v_status, '')) = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true, 'applied', false, 'action', 'noop_already_cancelled',
      'reservation_id', v_res_id, 'rows_affected', 0, 'external_id', p_external_id
    );
  END IF;

  -- ── AC-4 하류상태 RESTRICT/ABORT (순소실0) ────────────────────────────────────
  --   check_ins(reservation_id 직결)가 하류 게이트의 앵커. 존재 시 내원이 발생한 예약 →
  --   결제/명세/진료가 이 예약(내원)에 매달릴 수 있으므로 취소 거부.
  SELECT count(*)::int INTO v_checkins
    FROM public.check_ins ci
   WHERE ci.reservation_id = v_res_id;

  IF v_checkins > 0 THEN
    SELECT count(*)::int INTO v_payments
      FROM public.payments p
      JOIN public.check_ins ci ON ci.id = p.check_in_id
     WHERE ci.reservation_id = v_res_id;
    SELECT count(*)::int INTO v_charges
      FROM public.service_charges sc
      JOIN public.check_ins ci ON ci.id = sc.check_in_id
     WHERE ci.reservation_id = v_res_id;
    SELECT count(*)::int INTO v_medcharts
      FROM public.medical_charts mc
      JOIN public.check_ins ci ON ci.id = mc.check_in_id
     WHERE ci.reservation_id = v_res_id;
  END IF;

  v_downstream := v_checkins + v_payments + v_charges + v_medcharts;

  IF v_downstream > 0 THEN
    -- 취소 거부: 하류 데이터 존재 → soft-cancel 미실행(예약 원상 보존). 정합경고 동봉.
    RETURN jsonb_build_object(
      'ok', true, 'applied', false, 'action', 'refused_downstream',
      'reservation_id', v_res_id, 'rows_affected', 0, 'external_id', p_external_id,
      'downstream', jsonb_build_object(
        'check_ins',       v_checkins,
        'payments',        v_payments,
        'service_charges', v_charges,
        'medical_charts',  v_medcharts
      ),
      'warning', '하류상태(내원/결제/명세/진료) 존재 — 취소 거부(순소실0). 현장 수기 확인 필요.'
    );
  END IF;

  -- ── soft-cancel 실행 (foot lane: status='cancelled' 전이 + 슬롯 release) ────────
  UPDATE public.reservations r
     SET status     = 'cancelled',
         memo       = CASE
                        WHEN NULLIF(btrim(p_reason), '') IS NOT NULL
                        THEN COALESCE(r.memo || E'\n', '') || '[취소·도파민 전파] ' || btrim(p_reason)
                        ELSE r.memo
                      END,
         updated_at = now()
   WHERE r.id = v_res_id
     AND r.status <> 'cancelled';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- ── AC-5 rows-affected 검증 (cross_crm_write_rowcheck_standard) ────────────────
  --   0-row(+error=null) 를 성공으로 오독 금지 → 사후 re-probe.
  IF v_rows = 0 THEN
    SELECT lower(r.status) INTO v_reprobe FROM public.reservations r WHERE r.id = v_res_id;
    IF v_reprobe = 'cancelled' THEN
      -- 경합(concurrent cancel) — 이미 cancelled = 멱등 성공.
      RETURN jsonb_build_object(
        'ok', true, 'applied', false, 'action', 'noop_already_cancelled',
        'reservation_id', v_res_id, 'rows_affected', 0, 'external_id', p_external_id
      );
    END IF;
    -- non-cancelled 인데 0-row = silent write-failure → fail-loud.
    RAISE EXCEPTION
      'cancel_reservation_from_source: 0-row write (rid=%, status=%) — silent write-failure guard',
      v_res_id, v_reprobe USING ERRCODE = '25000';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'applied', true, 'action', 'cancelled',
    'reservation_id', v_res_id, 'rows_affected', v_rows, 'external_id', p_external_id
  );
END;
$$;

-- service_role 전용 (anon/authenticated 차단) — cross-CRM push/cancel 는 service_role 키로만 호출.
REVOKE ALL ON FUNCTION public.cancel_reservation_from_source(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_reservation_from_source(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_reservation_from_source(TEXT, TEXT, TEXT) FROM authenticated;

COMMENT ON FUNCTION public.cancel_reservation_from_source(TEXT, TEXT, TEXT) IS
  '도파민 emit(예약삭제 leg4 forward soft-cancel) → 풋 예약 soft-cancel consumer. 멱등키=(source_system=''dopamine'', external_id=cue_card_id). AC-3 fail-close(dopamine만) · AC-2 멱등(부재/이미취소=no-op) · AC-4 하류(check_ins/payments/service_charges/medical_charts) 존재 시 취소거부(순소실0) · AC-5 rows-affected 검증+re-probe. status=''cancelled'' 전이(hard-DELETE 없음)+슬롯 release. RETURNS jsonb{ok,applied,action,reservation_id,rows_affected,downstream?,warning?}. T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC.';

COMMIT;

-- 사후 검증(수동):
--   SELECT pg_get_functiondef('public.cancel_reservation_from_source(text,text,text)'::regprocedure);
--   -- AC-3 fail-close: 비-dopamine → 예외
--   SELECT public.cancel_reservation_from_source('aicc','x');           -- ERROR 22023
--   -- AC-2 멱등: 미존재 external_id → noop_absent
--   SELECT public.cancel_reservation_from_source('dopamine','no-such'); -- {ok,applied:false,action:noop_absent}
--   -- AC-1 취소: 활성 dopamine 예약 → cancelled + 슬롯 release
--   -- AC-4 refuse: check_in 있는 예약 → {applied:false,action:refused_downstream,downstream:{...}}

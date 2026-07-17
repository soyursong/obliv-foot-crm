-- T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE — 접근 B (서버사이드 check_ins emit, stage 축)
-- 풋 CRM 내원확정(check_ins INSERT) → 도파민 foot-callback-recv 로 stage='visited' emit (live).
--
-- 근인(STATS-OBLIVJONGNO): 도파민 "내원수·추세선"을 구동하는 축 = cue_cards.stage='visited'.
--   이 축을 채우는 수신부(foot-callback-recv)는 이미 존재·live 이나, 풋 발신부가 **미배선**
--   (dopamine-callback/checkin-visited-fire EF 의 visited 브랜치는 완비돼 있으나 콜사이트 0 = orphan).
--   ⇒ stage 축이 영구 lead/reserved → 종로>문제성발톱 내원수·추세선 미표시.
--
-- ★ DA 판정 SSOT: da_decision_foot_checkin_visited_emit_approach_20260718.md (verdict=GO, 접근 B).
--   MSG-20260718-002223-h576. db_change:false→true 승인. ADDITIVE 한정.
--   접근 A(FE-invoke, 스태프만) 반려 = 셀프QR 누락 → 과소집계 false-fix.
--   접근 B = check_ins AFTER INSERT 서버 emit → 스태프+셀프QR+워크인 소스앱 무관 균일 커버.
--
-- ★ 선행 확인(DA 전제, dev-foot 완료 2026-07-18): 셀프QR 내원은 별도 앱(foot-checkin.pages.dev)
--   이나 public.self_checkin_with_reservation_link RPC(SECURITY DEFINER, GRANT anon)로
--   **동일 obliv-foot-crm Supabase 프로젝트의 check_ins 테이블에 INSERT** 함을 코드로 확인.
--   ⇒ AFTER INSERT 트리거가 셀프QR 포착 = B 완결. foot-checkin sibling repo 티켓 불요.
--
-- ── 축 분리(DA 가드레일 5, 병합 금지) ────────────────────────────────────────────
--   · stage='visited'(foot-callback-recv)      = 본 마이그(신규 leg, event_type='visited_stage')
--   · process_status='VISITED'(crm-lifecycle-callback) = 기존 enqueue_dopamine_callback('visited')
--     — 무접촉 보존. 동일 check_ins INSERT 에서 두 트리거가 각각 발화 = 축 parity(의도된 정상).
--   두 축은 별개 callback_type·별개 endpoint·별개 outbox 행으로 유지. 병합·기존경로 변경 없음.
--
-- ── 단일생산자(DA 가드레일 1) ────────────────────────────────────────────────────
--   stage='visited' 생산자 = 본 서버 emit 경로 1개(→ foot-callback-recv). FE(ReservationDetail
--   Popup 등) visited invoke 미배선 유지(추가 안 함) → 이중 emit 원천 차단.
--   crm-lifecycle-callback 은 stage 미생산 유지(확장 금지).
--
-- ── 신뢰성(DA 가드레일 2, HTTP-in-trigger 금지) ───────────────────────────────────
--   트리거는 outbox enqueue 만. 동기 pg_net/http POST 안 함. 기존 인프라 재사용:
--   dopamine_callback_outbox + process_dopamine_callback_outbox(pg_cron backoff/DLQ)
--   + dopamine-callback-dispatch EF(event_type 라우팅 discriminator 추가분). (T-20260602 인프라)
--
-- ── 멱등(DA 가드레일 3) ──────────────────────────────────────────────────────────
--   event_id = check_in.id (one-shot). outbox UNIQUE(event_type, event_id) + 수신부
--   foot_callback_log UNIQUE(type, event_id) 이중 dedup. 재발화/재시도/중복 check-in 안전.
--
-- ── 누출 가드(DA 가드레일 4) ──────────────────────────────────────────────────────
--   source_system='dopamine' + external_id 존재 건만 emit. foot-direct/walk-in(cue_card 부재)
--   = skip. 비-도파민 무발신. (기존 enqueue_dopamine_callback 과 동일 게이트.)
--
-- ── 수신부 계약(foot-callback-recv, 코드 실측 tm-flow) ────────────────────────────
--   필수 필드: {type, external_id, event_id, occurred_at, payload}. type='visited' → cue_cards.stage='visited'.
--   auth: X-Callback-Secret(수신 env FOOT_INBOUND_SECRET) ↔ 발신 FOOT_CALLBACK_SECRET(폴백 DOPAMINE_CALLBACK_SECRET).
--   payload shape = 기존 buildVisitedPayload(dopamine-callback EF) 미러 = DA 승인 envelope 재사용(MSG-kumo).
--
-- ⚠ 배포 순서 게이트(supervisor): dopamine-callback-dispatch EF(visited_stage 라우팅) 를 **먼저** 배포한 뒤
--   본 마이그 적용. 역순이면 구 dispatch 가 visited_stage 행을 crm-lifecycle-callback 로 오라우팅 → 4xx/DLQ.
--
-- soak: stage 축 shadow-gate 불요(foot-callback-recv 이미 live). emit-live 후 parity soak(DA 일일감사 축①·⑤)로 대조.
-- ADDITIVE: 신규 CHECK 값 1개 + 신규 트리거함수 1개 + 신규 트리거 1개. 기존 값/행/경로/트리거 무손상.
--
-- 롤백: 20260718120000_foot_checkin_visited_stage_emit.rollback.sql
-- dry-run: 20260718120000_foot_checkin_visited_stage_emit.dryrun.sql (No-Persistence)
-- 작성: dev-foot / 2026-07-18 / ticket T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) event_type CHECK 확장 (ADDITIVE) — 'visited_stage' 등재 (stage 축 라우팅 discriminator)
--    기존 값(visited/no_show/cancelled/rejected/reschedule) 전부 보존 + visited_stage 추가.
--    기존 행은 신규 값을 쓰지 않으므로 검증 위반 0 (무손상).
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;

ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected','reschedule','visited_stage'));

-- ══════════════════════════════════════════════════════════════════
-- 2) enqueue_dopamine_visited_stage() — check_ins INSERT → stage 축 outbox 적재 (신규)
--    ※ 기존 enqueue_dopamine_callback()(visited=process_status 축 → crm-lifecycle-callback)은 무접촉.
--       stage 축은 별 트리거로 분리(관심사 격리, reschedule 선례와 동일 패턴).
--    ※ outbox.payload = foot-callback-recv 수신 envelope 그대로(dispatch 가 mode 미주입 forward).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_dopamine_visited_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resv RECORD;
BEGIN
  -- reservation 미연결(순수 워크인 등) = cue_card 부재 → skip
  IF NEW.reservation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id, r.source_system, r.external_id
    INTO v_resv
    FROM public.reservations r
    WHERE r.id = NEW.reservation_id;

  -- 도파민 연동(source_system=dopamine + external_id) 건만 발사. 그 외 무발신(가드레일 4).
  IF NOT FOUND
     OR v_resv.source_system IS DISTINCT FROM 'dopamine'
     OR v_resv.external_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.dopamine_callback_outbox
    (event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    'visited_stage',
    NEW.id::TEXT,                 -- 멱등키 = check_in.id (one-shot, 가드레일 3)
    NEW.reservation_id,
    v_resv.external_id,          -- outbox 부기용 cue_card_id
    jsonb_build_object(
      -- ↓ foot-callback-recv 수신 envelope (필수: type/external_id/event_id/occurred_at/payload)
      'source_system', 'foot',
      'clinic_slug',   'jongno-foot',        -- canonical (normalizeSlug('foot-jongno'))
      'external_id',   v_resv.external_id,   -- cue_cards.id (동행 "{uuid}_comp_{key}" 후방호환은 수신부 처리)
      'type',          'visited',            -- stage='visited' 전이 트리거
      'event_id',      NEW.id::TEXT,
      'occurred_at',   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'payload', jsonb_build_object(
        'checkin_method', 'crm_server_emit',  -- 서버 emit(전 소스 균일). 수신부는 auxiliary 취급.
        'reservation_id', NEW.reservation_id
      )
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;  -- 멱등 적재 (재발화/중복 check-in 무손상)

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_dopamine_visited_stage() IS
  'T-CHECKIN-VISITED-EMIT(접근 B): check_ins INSERT → stage 축(foot-callback-recv) visited outbox 적재. '
  '도파민 연동(source_system=dopamine + external_id) 건만. event_id=check_in.id. '
  'payload=foot-callback-recv envelope(type=visited). 동기 발송 X(worker/dispatch 소유). '
  'process_status 축(enqueue_dopamine_callback/crm-lifecycle-callback)과 별개 = 축 parity.';

DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin_stage ON public.check_ins;
CREATE TRIGGER trg_dopamine_cb_checkin_stage
  AFTER INSERT ON public.check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_dopamine_visited_stage();

COMMIT;

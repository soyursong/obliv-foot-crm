-- T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE — 풋(발톱) CRM 예약취소 → 도파민 crm-cancel-callback(live 취소 SSOT rail) emit 배선
-- 재라우팅 dopamine→foot (DA CONSULT-REPLY MSG-20260807-061709-hpoa, SSOT=da_replies/da_decision_dopamine_crm_cancel_callback_foot_coverage_20260807.md)
-- 부모: T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14 (as-scoped 백필 DEAD·convergence 목표는 본 forward-fix로 달성)
--
-- ══ 문제 ══
--   풋 예약취소가 도파민 cue 로 전파 안 됨 = census C(T-20260807-foot-CANCEL-ORPHAN-CENSUS-C) 36건 중 31 divergent
--   (foot cancelled ∧ dopamine reservations.is_cancelled=false live). 근본원인 = live 취소 SSOT rail
--   (crm-cancel-callback)에 foot-emit 미배선. DA census: cancel_sync_log source 카운트 foot:2(1건 합성 e2e)/
--   crm:1249/scalp:56 = foot 취소 emit 트래픽 사실상 부재. 수신부(crm-cancel-callback EF)는 foot-coverage 완비
--   (source_system='foot' 수용·복합키 source_crm+crm_reservation_id 비협상) = 갭 아님. 실 갭 = foot-emit.
--
-- ══ ★HARD 불변식 (절대 — 위반 시 자동 NO-GO) ══
--   ① lifecycle rail(crm-lifecycle-callback) 재활성 금지 = gjv7 INVARIANT-1(2nd-writer eventscope) 위반.
--      foot cancelled = 그 rail 영구 audit-only.
--   ② foot outbox → lifecycle re-enqueue = DEAD(부모 T-20260727 as-scoped 백필 DA REFUTED).
--   ⇒ 본 마이그는 lifecycle rail 무접촉. 기존 dopamine_callback_outbox(visited/no_show/cancelled/rejected) +
--      enqueue_dopamine_callback 트리거 + dopamine-callback-dispatch(→crm-lifecycle-callback) = 전부 무변경.
--      본 마이그는 **별개 신규 rail**(cancel_sync_outbox → crm-cancel-callback live SSOT)만 배선. 두 rail 직교.
--
-- ══ 착지 = DA CONSULT-REPLY payload-contract 요건 ══
--   ① cancelled_at 권위소스 supply — foot cancelled 시각을 payload 에 실어 보냄(reservations.cancelled_at).
--      ★now() 합성 금지(emit 시점 fabricate 금지) — 취소 tx 시점에 원자 캡처된 authoritative 시각을 outbox 에
--      적재·EF 가 그대로 송신. 불변식: is_cancelled=true ⟹ cancelled_at NOT NULL(BEFORE 트리거
--      trg_ensure_reservation_cancelled_at 이 취소 tx 시점 원자 보장 — 20260723210000).
--   ② cue-bearing 우선 — 기저(비동행) 예약은 cue_card_id(=reservations.external_id base UUID) 송신
--      → 수신부 경로 A(cue-bearing): cue_cards.stage='cancelled' + reservations.is_cancelled=true **양축 수렴**.
--      동행(companion) 예약은 부모 cue 오귀속 금지 → 복합키(source_crm=foot + crm_reservation_id) 송신
--      → 수신부 경로 B(복합키): 해당 미러만 is_cancelled=true. ★단일 crm_reservation_id 단독 = 수신부 400 REJECT
--      (source_crm 동반 필수). 상세는 EF crm-cancel-sync-emit 참조.
--   ③ secret — 공유 CANCEL_WEBHOOK_SECRET(crm/foot 공용) 수용(수신부 source='foot'→SHARED_SECRET 검증).
--      FOOT_CANCEL_SECRET = optional 하드닝(supervisor env 게이트, blocker 아님). EF 는 FOOT_CANCEL_SECRET ?? CANCEL_WEBHOOK_SECRET.
--
-- ══ 이중축 canonical (DA Q2, 참고 — 본 emit 은 축을 직접 write 안 함) ══
--   완전수렴 = both axes(reservations.is_cancelled=true AND cue_cards.stage='cancelled'). 축별 소유자 분리:
--   driver=is_cancelled(도파민 수신부 EF read-surface write) / stage=파생(도파민측 mirror trigger). foot-emit 은
--   cancelled_at+cue-bearing 을 정확히 실으면 됨 → 수신부가 양축 유발(경로 A). stage축은 도파민측 파생체인.
--
-- ══ change-class = ADDITIVE ══
--   신규 테이블 1(cancel_sync_outbox) + enqueue fn 1 + reservations AFTER UPDATE OF status 트리거 1 +
--   drain/alert fn 2 + cron 1. 기존 reservations 본체·dopamine_callback_outbox·enqueue_dopamine_callback·
--   dispatch(lifecycle) 무접촉. DROP/기존컬럼 ALTER/backfill 0. 트리거 EXCEPTION→WARNING(취소 tx 절대 비차단).
--   ★DB 스키마 필요 판명 = ticket db_change=false→true 갱신 사유(planner 통지). 대표게이트 = ADDITIVE + DA GO
--   → autonomy §3.1 면제, 잔여 = supervisor DDL-diff + EF-diff + env 게이트.
--   ★별 leg(본 forward-fix blocker 아님): historical 36 소급 reconciliation = 별 CONSULT/티켓(source-close FIRST 후 replay OR SOP backfill).
--
-- ══ foot 컨벤션 ══ get_vault_secret / app.supabase_url / internal_cron_secret / net.http_post(body=jsonb, ★::TEXT 금지
--   — 20260718130000 POST-FIX) / cron prefix 'foot-' / DLQ 알람 "[풋CRM]". 정본 미러 = payment_sync_outbox(20260730200000).
--
-- ══ 롤아웃(dark hold) ══
--   crm-cancel-sync-emit EF env CANCEL_SYNC_EMIT_ENABLED 기본 'false'(dark) → outbox 는 계속 적재, 드레이너는
--   EF 를 poke 하되 EF 가 dark 면 무발신(pending 보존). supervisor 가 (1) EF 배포 + (2) DOPAMINE_CALLBACK_URL/
--   secret(CANCEL_WEBHOOK_SECRET) 주입 확인 후 EF env 'true' flip. 수신부 crm-cancel-callback 은 foot-source 이미
--   수용(완비) → 조기발사 리스크 낮으나 twin(payment) 규율 유지(supervisor env 게이트 정합).
--
-- 롤백: 20260807120000_foot_cancel_sync_outbox_emit.rollback.sql
-- dry-run: 20260807120000_foot_cancel_sync_outbox_emit.dryrun.sql (No-Persistence)
-- 작성: dev-foot / 2026-08-07 · ticket: T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 확장 (idempotent) — pg_cron/pg_net 는 20260603/20260730 선례로 이미 활성
-- ══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════════
-- 1) cancel_sync_outbox — 취소 live-rail 전용 outbox (신설)
--    ★ crm-cancel-callback(live 취소 SSOT) 전용. dopamine_callback_outbox(lifecycle audit-only)와 분리·직교.
--    ★ target_crm 컬럼 없음(단일대상 = 도파민 crm-cancel-callback, 라우팅 불요).
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cancel_sync_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 멱등키(수신부 cancel_sync_log (source_system,event_id) 정합) = reservation_id:epoch(cancelled_at).
  --   distinct-per-occurrence(restore→재취소 시 매 취소가 distinct event_id — 조기 dedup drop 봉합,
  --   20260723210000 lifecycle 키잉과 동형). ::bigint 절삭 금지(sub-second 유지).
  event_id        TEXT         NOT NULL,
  -- 풋 예약 id — 복합키 crm_reservation_id + 관측.
  reservation_id  UUID         NOT NULL,
  -- reservations.external_id (도파민 cue_cards.id / 동행이면 "{uuid}_comp_{key}"). TEXT — 동행 suffix 운반.
  --   EF 가 resolveBaseCueCardId 로 base UUID/companion 판정.
  cue_card_id     TEXT         NOT NULL,
  -- 권위 취소시각(reservations.cancelled_at). ★now() 합성 금지 — EF 가 이 값 그대로 송신.
  cancelled_at    TIMESTAMPTZ  NOT NULL,
  payload         JSONB,                             -- enqueue 시점 스냅샷(관측/디버그용)
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,                              -- ★PHI 금지(응답 본문 미적재 — status/사유코드만)
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 취소 occurrence 당 1행(재-INSERT 이중발화 물리 차단). 재취소는 event_id distinct → 신규행 성립.
  CONSTRAINT uq_cancel_sync_outbox_event_id UNIQUE (event_id)
);

COMMENT ON TABLE public.cancel_sync_outbox IS
  'T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE: 풋 예약취소 → 도파민 crm-cancel-callback(live 취소 SSOT rail) '
  'emit outbox(source_system=foot). event_id=reservation_id:epoch(cancelled_at)(distinct-per-occurrence·UNIQUE). '
  'trigger=trg_enqueue_cancel_sync_from_reservations(AFTER UPDATE OF status ON reservations, cancelled 전이·dopamine-linked). '
  'drain=cancel_sync_drain() cron(foot-cancel-sync-drain) → crm-cancel-sync-emit EF. '
  '★lifecycle rail(crm-lifecycle-callback)와 직교·무접촉(gjv7 INVARIANT-1). payment_sync_outbox(20260730) 정본 미러.';

-- 픽업 partial idx (due + 미DLQ)
CREATE INDEX IF NOT EXISTS idx_cancel_sync_outbox_due
  ON public.cancel_sync_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

-- DLQ 미알람 픽업 idx
CREATE INDEX IF NOT EXISTS idx_cancel_sync_outbox_dlq_unalerted
  ON public.cancel_sync_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

-- 내부 전용 — RLS on, 공개 정책 없음(service_role EF 전용).
ALTER TABLE public.cancel_sync_outbox ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- 2) enqueue_cancel_sync_from_reservations() — reservations status→cancelled → outbox 적재(동기 발송 X)
--    누출가드: source_system='dopamine' + external_id 건만(도파민 귀속). 그 외 무발신.
--    ★ enqueue_dopamine_callback(lifecycle) 무접촉 — 별 트리거·별 outbox(관심사 격리, 두 rail 직교).
--    ★ cancelled_at 권위 = NEW.cancelled_at(BEFORE 트리거 trg_ensure_reservation_cancelled_at 로 취소 tx 시점
--       원자 보장). 여기서 now() 합성 안 함.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_cancel_sync_from_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id    TEXT;
BEGIN
  -- (a) cancelled 전이만(no_show/기타 스코프 밖 — 취소 rail 전용).
  IF NEW.status <> 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;  -- 동일상태 재기록 무시(멱등)

  -- (b) 도파민 연동(source_system='dopamine' + external_id) 건만 발사(누출가드).
  IF NEW.source_system IS DISTINCT FROM 'dopamine' OR NEW.external_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- (c) cancelled_at 권위 non-null 전제(BEFORE 트리거 보장). 방어적으로 재확인 — NULL 이면 skip(불변식 위반 방출 금지).
  IF NEW.cancelled_at IS NULL THEN
    RAISE WARNING 'enqueue_cancel_sync_from_reservations: cancelled_at NULL (resv=%) — skip(불변식 위반 방출 차단)', NEW.id;
    RETURN NEW;
  END IF;

  -- (d) 멱등키 = reservation_id:epoch(cancelled_at). distinct-per-occurrence(재취소 봉합).
  v_event_id := NEW.id::TEXT || ':' || extract(epoch from NEW.cancelled_at)::TEXT;

  -- (e) outbox 적재(occurrence 당 1행 멱등). cue_card_id 는 raw external_id(동행 가능 — EF 가 base 해소/companion 판정).
  INSERT INTO public.cancel_sync_outbox
    (event_id, reservation_id, cue_card_id, cancelled_at, payload)
  VALUES (
    v_event_id,
    NEW.id,
    NEW.external_id,
    NEW.cancelled_at,
    jsonb_build_object(
      'source_system',  'foot',
      'event_type',     'cancel',
      'event_id',       v_event_id,
      'reservation_id', NEW.id,
      'external_id',    NEW.external_id,
      'cancelled_at',   to_char(NEW.cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_id) DO NOTHING;  -- 멱등 적재

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 취소 트랜잭션을 절대 막지 않음(best-effort enqueue). 실패 시 WARNING 만.
  RAISE WARNING 'enqueue_cancel_sync_from_reservations failed (resv=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_cancel_sync_from_reservations() IS
  'T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE: reservations status→cancelled → cancel_sync_outbox 적재. '
  '도파민 귀속(source_system=dopamine + external_id) 건만(누출가드). event_id=reservation_id:epoch(cancelled_at)(distinct·멱등). '
  'cancelled_at=NEW.cancelled_at 권위(now() 합성 금지). 동기 발송 X. EXCEPTION→WARNING(취소 tx 비차단). '
  '★enqueue_dopamine_callback(lifecycle audit-only) 무접촉 — 별 rail 직교.';

-- AFTER UPDATE OF status — cancelled 전이 시 적재. BEFORE trg_ensure_reservation_cancelled_at 뒤 발화(cancelled_at 가시성 보장).
DROP TRIGGER IF EXISTS trg_enqueue_cancel_sync_from_reservations ON public.reservations;
CREATE TRIGGER trg_enqueue_cancel_sync_from_reservations
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND NEW.source_system = 'dopamine' AND NEW.external_id IS NOT NULL)
  EXECUTE FUNCTION public.enqueue_cancel_sync_from_reservations();

-- ══════════════════════════════════════════════════════════════════
-- 3) alert_cancel_sync_dlq() — DLQ 신규 → 슬랙 #infra-alerts 배치 알람 (payment twin 미러)
--    ★ net.http_post body=jsonb (foot POST-FIX 20260718130000, ::TEXT 캐스트 금지).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_cancel_sync_dlq()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_webhook TEXT;
  v_count   INT;
  v_sample  TEXT;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.cancel_sync_outbox WHERE dlq = true AND dlq_alerted = false;
  IF v_count = 0 THEN RETURN; END IF;

  BEGIN
    SELECT decrypted_secret INTO v_webhook
      FROM vault.decrypted_secrets WHERE name = 'slack_infra_alerts_webhook_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
  END;
  IF v_webhook IS NULL OR v_webhook = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_webhook
        FROM vault.decrypted_secrets WHERE name = 'slack_ops_webhook_url' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
    END;
  END IF;

  SELECT string_agg(format('%s(att=%s)', left(event_id, 8), attempts), ', ')
    INTO v_sample
    FROM (
      SELECT event_id, attempts FROM public.cancel_sync_outbox
        WHERE dlq = true AND dlq_alerted = false ORDER BY created_at LIMIT 10
    ) s;

  IF v_webhook IS NOT NULL AND v_webhook <> '' THEN
    PERFORM net.http_post(
      url     := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'text', format(
          ':rotating_light: *[풋CRM] 취소 sync DLQ 신규 %s건* — %s. '
          || '재시도 소진/영구실패. 확인: cancel_sync_outbox WHERE dlq=true. (%s)',
          v_count, COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )
    );
  ELSE
    RAISE LOG 'alert_cancel_sync_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;

  UPDATE public.cancel_sync_outbox
    SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMENT ON FUNCTION public.alert_cancel_sync_dlq() IS
  'T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE: 취소 sync DLQ 신규(dlq_alerted=false) 슬랙 배치 알람. '
  'webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback. 알람 후 dlq_alerted=true.';

-- ══════════════════════════════════════════════════════════════════
-- 4) cancel_sync_drain() — pg_cron 드레이너 백스톱: due 행 있으면 crm-cancel-sync-emit EF poke.
--    HTTP-in-trigger 금지: 드레이너가 EF 호출(net.http_post body=jsonb). EF 가 배치 drain·재시도 소유.
--    EF 자체 dark 게이트(CANCEL_SYNC_EMIT_ENABLED) → 미준비 window 무발신(pending 보존).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_sync_drain()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_pending INT;
  v_ef_url  TEXT;
  v_anon    TEXT;
  v_cron    TEXT;
  v_req_id  BIGINT;
BEGIN
  SELECT count(*) INTO v_pending
    FROM public.cancel_sync_outbox
    WHERE status = 'pending' AND dlq = false AND next_attempt_at <= now();

  -- 신규 DLQ 알람은 pending 유무 무관 매 틱 확인.
  PERFORM public.alert_cancel_sync_dlq();

  IF v_pending = 0 THEN
    RETURN jsonb_build_object('ok', true, 'drained', false, 'pending', 0);
  END IF;

  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'cancel_sync_drain: supabase url 미설정 — skip (pending=%)', v_pending;
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url', 'pending', v_pending);
  END IF;

  v_anon := COALESCE(
    current_setting('app.anon_key', TRUE),
    public.get_vault_secret('supabase_anon_key'),
    ''
  );
  v_cron := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  v_ef_url := v_ef_url || '/functions/v1/crm-cancel-sync-emit';

  SELECT net.http_post(
    url     := v_ef_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'Authorization',   'Bearer ' || v_anon,
      'X-Internal-Cron', v_cron
    ),
    body    := jsonb_build_object('trigger', 'pg_cron_backstop')
  ) INTO v_req_id;

  RETURN jsonb_build_object('ok', true, 'drained', true, 'pending', v_pending, 'request_id', v_req_id);
END;
$$;

COMMENT ON FUNCTION public.cancel_sync_drain() IS
  'T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE: cancel_sync_outbox 드레이너 백스톱 '
  '(net.http_post → crm-cancel-sync-emit EF). due 행 있을 때만 poke + 매 틱 DLQ 알람. '
  'EF 자체 dark 게이트(CANCEL_SYNC_EMIT_ENABLED)로 미준비 window 무발신. vault supabase_project_url/anon/cron.';

-- ══════════════════════════════════════════════════════════════════
-- 5) cron 스케줄 (분당 — 취소 전파 latency 완화; outbox 무손실 보증)
-- ══════════════════════════════════════════════════════════════════
SELECT cron.unschedule('foot-cancel-sync-drain')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-cancel-sync-drain');

SELECT cron.schedule(
  'foot-cancel-sync-drain',
  '* * * * *',
  $cron$ SELECT public.cancel_sync_drain(); $cron$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECK (supervisor) — DA GO 후에만 적용
-- [ ] cancel_sync_outbox 테이블 / UNIQUE(event_id) / idx_cancel_sync_outbox_due 생성
-- [ ] status CHECK = {pending,processing,sent,duplicate,failed} + dlq/dlq_alerted boolean, target_crm 부재
-- [ ] trg_enqueue_cancel_sync_from_reservations = AFTER UPDATE OF status ON public.reservations
--       WHEN(status=cancelled AND source_system=dopamine AND external_id NOT NULL)
-- [ ] cancel_sync_drain() / alert_cancel_sync_dlq() / cron 'foot-cancel-sync-drain'(*) 등록
-- [ ] ★lifecycle rail 무접촉 회귀0: dopamine_callback_outbox / enqueue_dopamine_callback /
--       dopamine-callback-dispatch(→crm-lifecycle-callback) / cron 무변경(잔존)
-- [ ] 기존 reservations UPDATE 경로 회귀 0 (trigger EXCEPTION→WARNING, 취소 비차단)
-- [ ] EF crm-cancel-sync-emit 배포 + env(DOPAMINE_CALLBACK_URL, CANCEL_WEBHOOK_SECRET[·FOOT_CANCEL_SECRET optional])
-- [ ] 수신부 crm-cancel-callback 이 foot source(source_system='foot') 수용 확인(완비 — 재확인만)
-- [ ] CANCEL_SYNC_EMIT_ENABLED='true' flip 은 위 EF/secret/URL 준비 후에만(조기 발사 방지)
-- [ ] 검증: 신규 도파민-귀속 예약 취소 1건 → outbox(pending→sent) → 도파민 cue_cards.stage='cancelled'
--       + reservations.is_cancelled=true 양축 수렴(경로 A)
-- [ ] 별 leg: historical 36 소급 reconciliation(source-close FIRST 후) = 별 CONSULT/티켓(본 forward-fix 밖)
-- ============================================================

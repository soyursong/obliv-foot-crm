-- T-20260602-multi-CALLBACK-EF-4-NEW — 풋 CRM outbox (발신부)
-- 풋 CRM → 도파민 라이프사이클 callback 발신 (transactional outbox 패턴)
--
-- ※ 롱레(dev-crm commit ca26361, 20260602100000) 미러링. 차이점만 풋 변형:
--    - payload.source_system = 'foot' (롱레='crm')
--    - 풋 reservations.status = ('confirmed','checked_in','cancelled','noshow')
--      → noshow(언더스코어 없음)를 계약 event_type 'no_show'로 매핑. 풋엔 rejected 예약상태 없음.
--    - 풋 컨벤션: get_vault_secret / internal_cron_secret / app.supabase_url / net.http_post,
--      cron 잡 prefix 'foot-'.
--
-- 명세: agents/docs/_draft/dopamine_callback_receive_pattern.md v0.1
-- 계약: T-20260602-multi-CALLBACK-EF-4-NEW §계약 확정 2026-06-02
--   호출 대상: 도파민 단일 EF crm-lifecycle-callback (4-EF 설계 철회)
--   payload 8필드: source_system('foot') / event_type(visited|no_show|cancelled|rejected)
--                  / event_id(멱등키) / cue_card_id / reservation_id / occurred_at
--                  / mode(shadow|live) / reason?
--   인증: 헤더 X-Callback-Secret (env DOPAMINE_CALLBACK_SECRET) — foot-callback-recv 동일 패턴
--   멱등: outbox event_id, 도파민 측 UNIQUE(source_system, event_id) 중복 차단
--
-- 스코프 (풋 AC-S1~S4):
--   AC-S1) dopamine_callback_outbox 테이블 — (id, event_type, payload, attempts,
--          next_attempt_at, last_error, dlq, created_at) + 멱등키/상태/감사 컬럼
--   AC-S2) 라이프사이클 트리거(visited/no_show/cancelled/rejected) → outbox INSERT
--          (동기 발송 X — outbox 적재만. 도파민 연동(source_system=dopamine + external_id) 건만.)
--   AC-S3) pg_cron worker(분당 1회) — exponential backoff (1·2·4·8·16·32·60min,
--          attempts>=7 시 dlq=true). claim→dispatch(EF)→상태전이.
--   AC-S4) DLQ 신규 1건+ → 슬랙 #infra-alerts 알람
--
-- 게이트: 1주 dry-run(shadow, 도파민 audit만, status 전환 X) → supervisor 확인 → live.
--   shadow/live 전환은 dopamine_callback_config.mode 1행 UPDATE 로만. 기본 'shadow'.
--   ※ 풋 기존 동기 경로(checkin-visited-fire/dopamine-callback → foot-callback-recv)와
--     본 outbox 경로(→ crm-lifecycle-callback)는 shadow 동안 공존. 본발효 컷오버는 supervisor.
--
-- 의존:
--   reservations(source_system, external_id, status) — 20260513000050 done
--   check_ins(reservation_id) — 20260419 initial done
--   pg_cron / pg_net / vault — messaging_module(20260525) 선례
--
-- 롤백: 20260603010000_dopamine_callback_outbox.rollback.sql
-- 작성: dev-foot / 2026-06-03
-- ticket: T-20260602-multi-CALLBACK-EF-4-NEW

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 확장 (idempotent)
-- ══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════════
-- AC-S1: outbox 테이블
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.dopamine_callback_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT         NOT NULL
                    CHECK (event_type IN ('visited','no_show','cancelled','rejected')),
  -- 멱등키 출처 (visited=check_in.id / 그 외=reservation.id)
  event_id        TEXT         NOT NULL,
  reservation_id  UUID,
  -- = reservations.external_id (도파민 cue_cards.id)
  cue_card_id     TEXT,
  payload         JSONB        NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dopamine_callback_outbox IS
  'T-CALLBACK-EF-4: 풋 CRM → 도파민 라이프사이클 콜백 outbox (source_system=foot). '
  '트리거가 적재(동기 발송 X), pg_cron worker가 분당 dispatch + backoff/DLQ.';

-- 멱등: 동일 (event_type, event_id) 1행만 (재진입/중복 트리거 무손상)
CREATE UNIQUE INDEX IF NOT EXISTS uq_dopamine_outbox_event
  ON public.dopamine_callback_outbox (event_type, event_id);

-- worker 픽업 인덱스 (due + 미DLQ)
CREATE INDEX IF NOT EXISTS idx_dopamine_outbox_due
  ON public.dopamine_callback_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

-- DLQ 미알람 픽업 인덱스
CREATE INDEX IF NOT EXISTS idx_dopamine_outbox_dlq_unalerted
  ON public.dopamine_callback_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

-- 내부 전용 — RLS on, 공개 정책 없음 (service_role 만 접근)
ALTER TABLE public.dopamine_callback_outbox ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- 게이트 설정 — shadow / live (단일 행)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.dopamine_callback_config (
  id          BOOLEAN     PRIMARY KEY DEFAULT true CHECK (id),
  mode        TEXT        NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','live')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.dopamine_callback_config (id, mode)
  VALUES (true, 'shadow')
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.dopamine_callback_config IS
  'T-CALLBACK-EF-4: 콜백 발효 모드. shadow=도파민 audit만(status 전환 X). '
  '1주 dry-run 후 supervisor 확인 → UPDATE mode=''live''.';

ALTER TABLE public.dopamine_callback_config ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- AC-S2: 라이프사이클 트리거 → outbox 적재 (동기 발송 X)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_dopamine_callback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type     TEXT;
  v_event_id       TEXT;
  v_reservation_id UUID;
  v_cue_card_id    TEXT;
  v_resv           RECORD;
BEGIN
  IF TG_TABLE_NAME = 'check_ins' THEN
    -- visited: 신규 체크인 → 연결 예약이 도파민 연동(external_id) 건일 때만
    IF NEW.reservation_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT r.id, r.source_system, r.external_id
      INTO v_resv
      FROM public.reservations r
      WHERE r.id = NEW.reservation_id;
    IF NOT FOUND
       OR v_resv.source_system IS DISTINCT FROM 'dopamine'
       OR v_resv.external_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_type     := 'visited';
    v_event_id       := NEW.id::TEXT;     -- check_in.id = 멱등키
    v_reservation_id := NEW.reservation_id;
    v_cue_card_id    := v_resv.external_id;
  ELSE
    -- reservations UPDATE — 풋 status('noshow'/'cancelled') 전이
    --   풋엔 'rejected' 예약상태 없음. noshow → 계약 event_type 'no_show' 매핑.
    IF NEW.status NOT IN ('noshow','cancelled') THEN
      RETURN NEW;
    END IF;
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;  -- 동일 상태 재기록 무시 (멱등)
    END IF;
    IF NEW.source_system IS DISTINCT FROM 'dopamine'
       OR NEW.external_id IS NULL THEN
      RETURN NEW;  -- 도파민 연동 건만 발사
    END IF;
    -- 풋 status → 계약 event_type 매핑 (noshow→no_show, cancelled→cancelled)
    v_event_type     := CASE NEW.status
                          WHEN 'noshow' THEN 'no_show'
                          ELSE NEW.status
                        END;
    v_event_id       := NEW.id::TEXT;     -- reservation.id = 멱등키
    v_reservation_id := NEW.id;
    v_cue_card_id    := NEW.external_id;
  END IF;

  INSERT INTO public.dopamine_callback_outbox
    (event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    v_event_type,
    v_event_id,
    v_reservation_id,
    v_cue_card_id,
    jsonb_build_object(
      'source_system',  'foot',
      'event_type',     v_event_type,
      'event_id',       v_event_id,
      'cue_card_id',    v_cue_card_id,
      'reservation_id', v_reservation_id,
      'occurred_at',    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;  -- 멱등 적재

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_dopamine_callback() IS
  'T-CALLBACK-EF-4: 라이프사이클(visited/no_show/cancelled/rejected) → outbox 적재. '
  '도파민 연동(source_system=dopamine + external_id) 건만. 풋 noshow→no_show 매핑. 동기 발송 안 함.';

DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin ON public.check_ins;
CREATE TRIGGER trg_dopamine_cb_checkin
  AFTER INSERT ON public.check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_dopamine_callback();

DROP TRIGGER IF EXISTS trg_dopamine_cb_resv ON public.reservations;
CREATE TRIGGER trg_dopamine_cb_resv
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_dopamine_callback();

-- ══════════════════════════════════════════════════════════════════
-- AC-S4: DLQ 신규 → 슬랙 #infra-alerts 알람
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_dopamine_callback_dlq()
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
    FROM public.dopamine_callback_outbox
    WHERE dlq = true AND dlq_alerted = false;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  -- #infra-alerts 전용 webhook → 없으면 ops webhook fallback
  BEGIN
    SELECT decrypted_secret INTO v_webhook
      FROM vault.decrypted_secrets
      WHERE name = 'slack_infra_alerts_webhook_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
  END;
  IF v_webhook IS NULL OR v_webhook = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_webhook
        FROM vault.decrypted_secrets
        WHERE name = 'slack_ops_webhook_url' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
    END;
  END IF;

  SELECT string_agg(
           format('%s/%s(att=%s)', event_type, left(event_id, 8), attempts), ', '
         )
    INTO v_sample
    FROM (
      SELECT event_type, event_id, attempts
        FROM public.dopamine_callback_outbox
        WHERE dlq = true AND dlq_alerted = false
        ORDER BY created_at
        LIMIT 10
    ) s;

  IF v_webhook IS NOT NULL AND v_webhook <> '' THEN
    PERFORM net.http_post(
      url     := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'text', format(
          ':rotating_light: *[풋CRM] 도파민 콜백 DLQ 신규 %s건* — %s. '
          || '재시도 소진/영구실패. 확인: dopamine_callback_outbox WHERE dlq=true. (%s)',
          v_count,
          COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )::TEXT
    );
  ELSE
    RAISE LOG 'alert_dopamine_callback_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;

  -- 알람 표시 (중복 알람 방지)
  UPDATE public.dopamine_callback_outbox
    SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMENT ON FUNCTION public.alert_dopamine_callback_dlq() IS
  'T-CALLBACK-EF-4: DLQ 신규(dlq_alerted=false) 건 슬랙 #infra-alerts 배치 알람. '
  '알람 후 dlq_alerted=true. webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback.';

-- ══════════════════════════════════════════════════════════════════
-- AC-S3: pg_cron worker — claim + dispatch + backoff
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_dopamine_callback_outbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_mode        TEXT;
  v_row         RECORD;
  v_claimed     INT := 0;
BEGIN
  SELECT mode INTO v_mode FROM public.dopamine_callback_config WHERE id = true;
  v_mode := COALESCE(v_mode, 'shadow');

  -- 풋 자체 dispatcher EF URL (풋 컨벤션: app.supabase_url → vault supabase_project_url)
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'process_dopamine_callback_outbox: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/dopamine-callback-dispatch';

  -- 내부 호출 시크릿 (풋 컨벤션: app.cron_secret → vault internal_cron_secret)
  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  -- due(pending) + stuck(processing 인데 next_attempt_at 경과) 회수 후 claim
  -- claim 시 attempts++ 및 backoff 선반영 (실패 시 그 시각까지 대기, 성공 시 무의미)
  --   backoff(min): attempts(증가후) 1→1, 2→2, 3→4, 4→8, 5→16, 6→32, 7+→60
  FOR v_row IN
    UPDATE public.dopamine_callback_outbox o
    SET status          = 'processing',
        attempts        = o.attempts + 1,
        next_attempt_at = now()
          + (LEAST(power(2, o.attempts)::INT, 60) || ' minutes')::INTERVAL,
        updated_at      = now()
    WHERE o.id IN (
      SELECT id FROM public.dopamine_callback_outbox
        WHERE dlq = false
          AND status IN ('pending', 'processing')
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o.payload
  LOOP
    v_claimed := v_claimed + 1;
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'X-Internal-Cron', v_cron_secret
      ),
      body    := jsonb_build_object('outbox_id', v_row.id, 'mode', v_mode)::TEXT
    );
  END LOOP;

  -- DLQ 신규 알람 (EF가 직전 틱에 set 한 dlq 건 포함)
  PERFORM public.alert_dopamine_callback_dlq();

  RETURN jsonb_build_object(
    'ok',       true,
    'mode',     v_mode,
    'claimed',  v_claimed,
    'run_at',   to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.process_dopamine_callback_outbox() IS
  'T-CALLBACK-EF-4: outbox worker(분당). due/stuck claim → attempts++/backoff 선반영 '
  '→ dopamine-callback-dispatch EF 호출 → DLQ 알람. backoff 1·2·4·8·16·32·60min.';

-- pg_cron 등록 (재실행 안전)
SELECT cron.unschedule('foot-dopamine-callback-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-dopamine-callback-worker');

SELECT cron.schedule(
  'foot-dopamine-callback-worker',
  '* * * * *',  -- 분당 1회
  $$ SELECT public.process_dopamine_callback_outbox() $$
);

COMMIT;

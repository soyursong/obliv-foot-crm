-- T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN — 상담 배정 [확정] ↔ Slack 발송 decouple resilience
--
-- ── 배경 (P0 회고 도출) ──
--   send-consult-notify EF 의 Slack 발송 502(channel_not_found) 하나가 상담 배정 [확정] 전체를 차단(P0 운영정지).
--   claim(consult_notify_status='sending') 은 rows=1 정상 영속했으나, 그 이후 Slack 발송 실패가 EF 단일 출구(구 L258 502)로
--   non-2xx 전파 → FE 가 [확정] 실패로 오인. = 외부 의존(Slack 채널) 하나가 임상 핵심 워크플로를 tight-couple.
--
-- ── DA CONSULT-REPLY (MSG-20260806-181946-wbis / da_decision_foot_consultconfirm_slack_decouple_harden_20260806.md) ──
--   verdict=GO(조건부)·change-class=ADDITIVE resilience(canon-conformance). §3.1 대표게이트 면제.
--   semantic: [확정] 성공 = claim write 영속(rows=1)만으로 성립. Slack 발송 = side-effect(계약상 성공조건 아님).
--   HARD 계약 5항(VG1~VG5) 전건 충족이 GO 조건.
--
-- ── 목표 (본 마이그 = HARD 계약의 DB 인프라) ──
--   VG1 durable enqueue(atomicity): claim + outbox enqueue 를 단일 txn(enqueue_consult_notify RPC)에 영속.
--                                   fire-and-forget silent drop 금지. enqueue 실패 시 claim 과 함께 롤백([확정] 동반 실패).
--   VG2 retry+backoff+DLQ: pg_cron worker(분당) 지수 backoff(1·2·4·8·16·32·60min) + attempts>=7 DLQ terminal.
--                          참조 dopamine_callback_outbox(T-CALLBACK-EF-4) 표준 그대로 이식(신규 표준 아님).
--   VG3 멱등 anchor: event_id = check_in_id UNIQUE. 재시도가 상담대기방에 중복 발송 금지. 성공 시 delivered('sent') 마킹.
--   VG4 발송실패 가시화: DLQ 전이 시 (a) check_ins.consult_notify_status='failed' 반영 → FE 배지 노출
--                       (b) alert_consult_notify_dlq() 슬랙 #infra-alerts 알람. silent DLQ 축적 금지.
--   VG5 channel_not_found 종단분류: 채널 소멸(self-heal 불가) → 무한 재시도 금지, dlq_reason='channel_gone' terminal 즉시 분류.
--                                   transient 5xx = retry / channel-gone = terminal (discriminator: dispatch EF 가 slack error 로 판정).
--
-- ── PHI 가드 판정 (dev-foot verify) ──
--   outbox payload = 순수 운영 메타(check_in_id / clinic_id / channel / inflow 라벨). 환자 신원(성명/차트/전화) 미포함.
--   발송 메시지의 [고객명]은 outbox 에 영속하지 않고 발송(EF/dispatch) 시점에 check_ins 에서 server-authoritative 재조회(transient).
--   → DLQ(장기 잔존 실패 저장소)에 미마스킹 PHI 축적 없음 = §16-3 마스킹 N/A. (VG-PHI: N/A — payload=운영 메타)
--
-- ── 매출귀속 RED LINE (INV-1) ──
--   본 마이그·RPC 는 consult_notify_* 발송상태 컬럼만 write. consultant_id / customers.assigned_consultant_id 무접촉.
--
-- 멱등: CREATE ... IF NOT EXISTS + 제약 DO-guard. CHECK 확장은 drop&recreate(DO-guard). ADDITIVE — 파괴적 변경 0.
-- Rollback: 20260807120000_foot_consult_notify_outbox_decouple.rollback.sql
-- Dry-run:  20260807120000_foot_consult_notify_outbox_decouple.dryrun.mjs (무영속 sentinel)
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff/MIG-GATE QA 게이트 선행.
-- 작성: dev-foot / 2026-08-07 / ticket: T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 확장 (idempotent) — dopamine_callback_outbox 선례와 동일
-- ══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════════
-- VG4-a: check_ins.consult_notify_status 에 'failed'(DLQ terminal) 상태 추가
--   기존 CHECK(chk_check_ins_consult_notify_status: NULL/'sending'/'sent') → 'failed' 포함으로 확장.
--   'failed' = 발송 재시도 소진/채널소멸(DLQ) → FE 배지 "발송실패" 노출(VG4 가시화). [확정] 자체는 이미 성공('sending' 경유).
-- ══════════════════════════════════════════════════════════════════
DO $consult_notify_status_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_check_ins_consult_notify_status'
       AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins DROP CONSTRAINT chk_check_ins_consult_notify_status;
  END IF;
  ALTER TABLE public.check_ins
    ADD CONSTRAINT chk_check_ins_consult_notify_status
    CHECK (consult_notify_status IS NULL
           OR consult_notify_status IN ('sending', 'sent', 'failed'));
END
$consult_notify_status_check$;

COMMENT ON COLUMN public.check_ins.consult_notify_status IS
  'T-20260729 변경2 + T-20260806-DECOUPLE-HARDEN: 상담 배정 상담대기방 발송상태. '
  'NULL=미확정, ''sending''=확정됨(발송 진행/재시도 대기), ''sent''=발송완료, ''failed''=발송실패(DLQ terminal, 배지 가시화). '
  '[확정] 성공 = ''sending'' claim 영속(rows=1). Slack 발송은 side-effect(outbox/retry/DLQ).';

-- ══════════════════════════════════════════════════════════════════
-- VG1/VG2/VG3: consult_notify_outbox 테이블 (dopamine_callback_outbox 미러)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.consult_notify_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id     UUID         NOT NULL,
  clinic_id       UUID         NOT NULL,
  -- VG3 멱등키 = check_in_id (재클릭·재시도 상담대기방 중복 발송 차단)
  event_id        TEXT         NOT NULL,
  channel         TEXT         NOT NULL,
  -- 유입경로 표시 라벨(운영 메타, non-PHI). 발송 메시지 [유입경로] 부분.
  inflow          TEXT,
  -- 운영 메타 only(PHI 미포함) — 고객명은 발송 시점 check_ins 에서 재조회(§16-3 N/A)
  payload         JSONB        NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  -- VG5 종단분류 discriminator: 'channel_gone'(즉시 terminal) | 'retry_exhausted'
  dlq_reason      TEXT,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  slack_ts        TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consult_notify_outbox IS
  'T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN: 상담 배정 [확정] 상담대기방 Slack 발송 outbox. '
  'claim(check_ins.consult_notify_status=sending)과 동일 txn(enqueue_consult_notify RPC)에 durable enqueue(VG1). '
  'pg_cron worker 가 backoff/DLQ 재시도(VG2). payload=운영 메타 only(PHI N/A).';

-- VG3 멱등: 동일 event_id(check_in_id) 1행만 (재클릭/재시도 무손상)
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_notify_outbox_event
  ON public.consult_notify_outbox (event_id);

-- worker 픽업 인덱스 (due + 미DLQ)
CREATE INDEX IF NOT EXISTS idx_consult_notify_outbox_due
  ON public.consult_notify_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

-- DLQ 미알람 픽업 인덱스
CREATE INDEX IF NOT EXISTS idx_consult_notify_outbox_dlq_unalerted
  ON public.consult_notify_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

-- 내부 전용 — RLS on, 공개 정책 없음 (service_role EF 만 접근)
ALTER TABLE public.consult_notify_outbox ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- VG1: 원자 enqueue RPC — claim(check_ins) + outbox INSERT 를 단일 txn 에 영속
--   반환:
--     claimed=false               → 이미 claim/발송(status != NULL). 재enqueue 없음(멱등, 이중발송 차단).
--     claimed=true, enqueued=true  → 신규 claim + outbox 적재 성공(정상 경로).
--     claimed=true, enqueued=false → claim 은 신규지만 outbox 는 기존행 존재(event_id 충돌) → 기존행 worker 재시도.
--   VG1 atomicity: INSERT 예외 발생 시 함수 txn 롤백 → claim 도 함께 롤백([확정] 동반 실패, gap 미생성).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_consult_notify(
  p_check_in_id UUID,
  p_clinic_id   UUID,
  p_inflow      TEXT,
  p_channel     TEXT,
  p_user_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed  INT;
  v_enqueued INT;
  v_outbox   UUID;
BEGIN
  -- ① 조건부 claim: NULL → 'sending' (rows-affected 가드 = 멱등 앵커, DID-IT-PERSIST)
  UPDATE public.check_ins
     SET consult_notify_status = 'sending',
         consult_notify_by     = p_user_id
   WHERE id = p_check_in_id
     AND clinic_id = p_clinic_id
     AND consult_notify_status IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed = 0 THEN
    -- 이미 claim('sending')/발송('sent')/실패('failed') — 이중 enqueue 금지(VG3)
    RETURN jsonb_build_object('claimed', false, 'enqueued', false);
  END IF;

  -- ② durable enqueue (VG1) — 동일 txn. event_id=check_in_id UNIQUE(VG3).
  INSERT INTO public.consult_notify_outbox
    (check_in_id, clinic_id, event_id, channel, inflow, payload)
  VALUES (
    p_check_in_id,
    p_clinic_id,
    p_check_in_id::TEXT,
    p_channel,
    NULLIF(p_inflow, ''),
    jsonb_build_object(
      'check_in_id', p_check_in_id,
      'clinic_id',   p_clinic_id,
      'channel',     p_channel,
      'inflow',      NULLIF(p_inflow, '')
    )
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_outbox;
  GET DIAGNOSTICS v_enqueued = ROW_COUNT;

  RETURN jsonb_build_object(
    'claimed',   true,
    'enqueued',  v_enqueued > 0,
    'outbox_id', v_outbox
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_consult_notify(UUID, UUID, TEXT, TEXT, UUID) IS
  'T-20260806-DECOUPLE-HARDEN VG1: claim(check_ins NULL→sending) + consult_notify_outbox 적재를 단일 txn 원자 영속. '
  'claimed=false 면 이미 확정(멱등). INSERT 예외 시 claim 동반 롤백([확정] 동반 실패, silent gap 미생성). '
  'intended-caller-tier: backend-only(send-consult-notify EF/service_role 전용, PUBLIC/anon/authenticated 봉인·§6 C23).';

-- ══════════════════════════════════════════════════════════════════
-- VG4-b: DLQ 신규 → 슬랙 #infra-alerts 알람 (alert_dopamine_callback_dlq 미러)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_consult_notify_dlq()
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
    FROM public.consult_notify_outbox
    WHERE dlq = true AND dlq_alerted = false;

  IF v_count = 0 THEN
    RETURN;
  END IF;

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
           format('%s(att=%s,%s)', left(event_id, 8), attempts, COALESCE(dlq_reason, '?')), ', '
         )
    INTO v_sample
    FROM (
      SELECT event_id, attempts, dlq_reason
        FROM public.consult_notify_outbox
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
          ':rotating_light: *[풋CRM] 상담대기방 알림 발송 실패(DLQ) 신규 %s건* — %s. '
          || '확정은 완료됐으나 상담대기방 알림 미발송. 채널 재배선 필요: consult_notify_outbox WHERE dlq=true. (%s)',
          v_count,
          COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )::TEXT
    );
  ELSE
    RAISE LOG 'alert_consult_notify_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;

  UPDATE public.consult_notify_outbox
    SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMENT ON FUNCTION public.alert_consult_notify_dlq() IS
  'T-20260806-DECOUPLE-HARDEN VG4: consult_notify_outbox DLQ 신규(dlq_alerted=false) 건 슬랙 #infra-alerts 배치 알람. '
  'webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback. silent DLQ 축적 방지. '
  'intended-caller-tier: backend-only(worker/service_role EF 전용, PUBLIC/anon/authenticated 봉인·§6 C23).';

-- ══════════════════════════════════════════════════════════════════
-- VG2: pg_cron worker — claim + dispatch + backoff (process_dopamine_callback_outbox 미러)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_consult_notify_outbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_row         RECORD;
  v_claimed     INT := 0;
BEGIN
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'process_consult_notify_outbox: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/consult-notify-dispatch';

  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  -- due(pending) + stuck(processing 인데 next_attempt_at 경과) 회수 후 claim
  --   backoff(min): attempts(증가후) 1→1, 2→2, 3→4, 4→8, 5→16, 6→32, 7+→60
  FOR v_row IN
    UPDATE public.consult_notify_outbox o
    SET status          = 'processing',
        attempts        = o.attempts + 1,
        next_attempt_at = now()
          + (LEAST(power(2, o.attempts)::INT, 60) || ' minutes')::INTERVAL,
        updated_at      = now()
    WHERE o.id IN (
      SELECT id FROM public.consult_notify_outbox
        WHERE dlq = false
          AND status IN ('pending', 'processing')
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id
  LOOP
    v_claimed := v_claimed + 1;
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'X-Internal-Cron', v_cron_secret
      ),
      body    := jsonb_build_object('outbox_id', v_row.id)::TEXT
    );
  END LOOP;

  -- DLQ 신규 알람 (dispatch EF 가 직전 틱에 set 한 dlq 건 포함)
  PERFORM public.alert_consult_notify_dlq();

  RETURN jsonb_build_object(
    'ok',      true,
    'claimed', v_claimed,
    'run_at',  to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.process_consult_notify_outbox() IS
  'T-20260806-DECOUPLE-HARDEN VG2: consult_notify_outbox worker(분당). due/stuck claim → attempts++/backoff 선반영 '
  '→ consult-notify-dispatch EF 호출 → DLQ 알람. backoff 1·2·4·8·16·32·60min. '
  'intended-caller-tier: backend-only(pg_cron/service_role EF 전용, PUBLIC/anon/authenticated 봉인·§6 C23).';

-- pg_cron 등록 (재실행 안전)
SELECT cron.unschedule('foot-consult-notify-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-consult-notify-worker');

SELECT cron.schedule(
  'foot-consult-notify-worker',
  '* * * * *',  -- 분당 1회
  $$ SELECT public.process_consult_notify_outbox() $$
);

-- ══════════════════════════════════════════════════════════════════
-- grant-seal (C23 — intended-caller-tier: backend-only, §15-5-10)
--   FIX-REQUEST MSG-20260813-173403-23uv: 신규 SECDEF 함수 3종이 grant-seal 절 부재 →
--   foot postgres-owner default-priv 상속으로 authenticated EXECUTE 잔차(실측 미러
--   process_dopamine_callback_outbox proacl={postgres,authenticated,service_role}).
--   anon EXECUTE=0(급성 RLS-우회 없음·C23-2 PASS)이나 신규/재정의 backend-only SECDEF =
--   C23-1(tier 선언)+C23-3(authenticated 봉인) 의무 대상.
--   3종 전부 backend-only 확증: 호출자 = send-consult-notify EF(service_role) +
--   consult-notify-dispatch EF(service_role) + pg_cron worker. authenticated/anon-context
--   직접 caller 0건(repo grep 실측). FE 는 EF 엔드포인트만 invoke(RPC 직접호출 없음).
--   ∴ service_role 단독 봉인이 어떤 caller 도 깨지 않음.
--   intended-caller-tier: backend-only (service_role EF + pg_cron worker only)
--   per-fn targeted 봉인만(blanket ALTER DEFAULT PRIVILEGES ... REVOKE FROM authenticated 금지·C23-4).
-- ══════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.enqueue_consult_notify(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_consult_notify_outbox()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.alert_consult_notify_dlq()                       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_consult_notify(uuid,uuid,text,text,uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.process_consult_notify_outbox()                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.alert_consult_notify_dlq()                       TO service_role;

COMMIT;

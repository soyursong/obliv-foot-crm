-- T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN
--   상담 배정 [확정] ↔ Slack 상담대기방 발송 decouple resilience (canon-conformance, ADDITIVE).
--
-- 배경(P0 회고): send-consult-notify EF 단일출구가 Slack 발송 실패(502 channel_not_found)를
--   [확정] 성공경로에 우발 결합 → 당일 상담배정 전면 정지(P0). [확정] 성공 = claim write 영속(rows=1)이며
--   Slack 발송은 side-effect(best-effort). 본 마이그는 notify 를 outbox/retry/DLQ 로 강등한다.
--
-- 패턴 = 기존 dopamine_callback_outbox(T-CALLBACK-EF-4, 20260603010000) Retry/DLQ 표준 그대로 이식(신규표준 아님).
--   참조: agents/docs skill 'CRM → 도파민 Callback 수신 패턴 + Retry/DLQ 표준'.
-- DA SSOT: da_replies/da_decision_foot_consultconfirm_slack_decouple_harden_20260806.md
--   verdict=GO(조건부)·ADDITIVE·§3.1 대표게이트 면제. change-class=ADDITIVE resilience.
--
-- HARD 계약조건(VG1~VG5) 매핑:
--   VG1 durable enqueue(atomicity)  → enqueue_consult_notify() RPC: claim(check_ins) + outbox INSERT 동일 txn.
--                                      enqueue 실패 시 RAISE → 전체 롤백 → claim 무효([확정]과 함께 실패). silent drop 0.
--   VG2 retry + backoff + DLQ 종단   → process_consult_notify_outbox() worker: exp backoff 1·2·4·8·16·32·60min, attempts>=7 → dlq.
--   VG3 멱등 anchor                  → uq_consult_notify_outbox_event UNIQUE(event_id=check_in.id). 발송성공 시 delivered 마킹(재발송 0).
--   VG4 발송실패 가시화(load-bearing) → (a) alert_consult_notify_dlq() → 슬랙 #infra-alerts (b) check_ins.consult_notify_status='failed'
--                                      → FE Assignments 상담탭 '발송실패' 배지(dispatcher EF write). 최소 1 이상 충족(둘 다).
--   VG5 channel_not_found 종단분류    → dispatcher EF error_class discriminator: channel-gone=terminal(무한재시도 금지·즉시 DLQ),
--                                      transient 5xx=retry. (분류 로직=EF; outbox.error_class 컬럼에 기록.)
--
-- PHI 가드(dev-foot verify): outbox.payload 는 순수 운영메타(check_in_id/clinic_id/inflow 라벨)만 저장.
--   환자 성명(customer_name)·Slack mention 은 dispatcher EF 가 발송시점에 check_ins/staff 에서 server-authoritative 해소.
--   → DLQ(장기 잔존 실패저장소)에 환자 신원(성명/차트/전화) 미축적 = §16-3 마스킹 정합 N/A-by-design. (verify-gate 판정: PASS)
--
-- 매출귀속 RED LINE(INV-1): RPC/워커/dispatcher 어디도 consultant_id / assigned_consultant_id write 0. consult_notify_* 컬럼만.
--
-- 롤백: 20260806210000_foot_consult_notify_outbox_decouple.rollback.sql (ADDITIVE 전량 제거, 순소실 0)
-- dry-run: 20260806210000_foot_consult_notify_outbox_decouple.dryrun.mjs (No-Persistence Protocol)
-- 작성: dev-foot / 2026-08-06 / ticket T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 확장 (idempotent)
-- ══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════════
-- 1) outbox 테이블 (dopamine_callback_outbox 미러)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.consult_notify_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- VG3 멱등키 = check_in.id (배정건 1건당 상담대기방 발송 1회)
  event_id        TEXT         NOT NULL,
  check_in_id     UUID         NOT NULL,
  clinic_id       UUID         NOT NULL,
  -- 발송 대상 Slack 채널(발송시점 값 고정 — 이후 채널복구/재배선 forensics)
  channel         TEXT         NOT NULL,
  -- 유입경로 라벨(TM/인바운드/워크인 …) = 운영메타(non-PHI)
  inflow          TEXT,
  -- 담당실장 = mention 해소 대상(dispatcher 가 staff.slack_user_id → 6명 매핑 fallback)
  consultant_id   UUID,
  -- 운영메타 전용 payload. ★환자 성명(customer_name)·mention 미저장 → dispatcher 가 발송시점 해소(PHI 가드).
  payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','delivered','duplicate','failed')),
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,
  -- VG5 종단분류 discriminator: transient(재시도) | terminal(즉시 DLQ, 무한재시도 금지)
  error_class     TEXT         CHECK (error_class IS NULL OR error_class IN ('transient','terminal')),
  dlq             BOOLEAN      NOT NULL DEFAULT false,
  dlq_alerted     BOOLEAN      NOT NULL DEFAULT false,
  slack_ts        TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consult_notify_outbox IS
  'T-20260806-CONSULTCONFIRM-SLACK-DECOUPLE: 상담 배정 [확정] → 상담대기방 Slack 발송 outbox. '
  'RPC enqueue_consult_notify 가 claim 과 동일 txn 적재(VG1), pg_cron worker 가 분당 dispatch + backoff/DLQ(VG2). '
  'payload=운영메타만(환자 성명 미저장 — dispatcher 발송시점 해소, PHI 가드).';

-- VG3 멱등: 동일 event_id(check_in.id) 1행만 (재클릭/동시클릭/재시도 무손상, 중복발송 0)
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_notify_outbox_event
  ON public.consult_notify_outbox (event_id);

-- worker 픽업(due + 미DLQ)
CREATE INDEX IF NOT EXISTS idx_consult_notify_outbox_due
  ON public.consult_notify_outbox (next_attempt_at)
  WHERE status IN ('pending','processing') AND dlq = false;

-- DLQ 미알람 픽업(VG4)
CREATE INDEX IF NOT EXISTS idx_consult_notify_outbox_dlq_unalerted
  ON public.consult_notify_outbox (created_at)
  WHERE dlq = true AND dlq_alerted = false;

-- 내부 전용 — RLS on, 공개 정책 없음 (service_role 만 접근)
ALTER TABLE public.consult_notify_outbox ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════
-- 2) CHECK 확장 — consult_notify_status 에 'failed' 추가 (VG4 FE 가시화)
--    ADDITIVE: 기존 값('sending','sent') 무변경 + 'failed'(발송 종단실패) 추가.
--    (Lovable 신규 상태값 추가 시 CHECK 동시 갱신 정책 준수.)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS chk_check_ins_consult_notify_status;
ALTER TABLE public.check_ins
  ADD CONSTRAINT chk_check_ins_consult_notify_status
  CHECK (consult_notify_status IS NULL OR consult_notify_status IN ('sending','sent','failed'));

-- ══════════════════════════════════════════════════════════════════
-- 3) VG1 — 원자적 claim + enqueue RPC (동일 txn, silent drop 0)
--    반환: {ok, claimed(bool), enqueued(bool), outbox_id, reason?}
--    ⚠ INV-1 RED LINE: SET 절에 consult_notify_* 컬럼만. consultant_id/assigned_consultant_id 절대 미포함.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_consult_notify(
  p_check_in_id UUID,
  p_clinic_id   UUID,
  p_channel     TEXT,
  p_inflow      TEXT,
  p_actor       UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci        RECORD;
  v_claimed   INT := 0;
  v_enqueued  INT := 0;
  v_outbox_id UUID;
BEGIN
  -- 배정건 로드 + 잠금 (동시 claim 직렬화)
  SELECT id, consultant_id, consult_notify_status
    INTO v_ci
    FROM public.check_ins
    WHERE id = p_check_in_id AND clinic_id = p_clinic_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_ci.consultant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_consultant');
  END IF;
  -- 이미 확정(멱등) — 재클릭/동시클릭/발송실패('failed') 재확정 금지
  IF v_ci.consult_notify_status IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'already');
  END IF;

  -- 조건부 claim: NULL → 'sending' (= [확정] 성공 = 권위 상태전이)
  UPDATE public.check_ins
    SET consult_notify_status = 'sending',
        consult_notify_by     = p_actor
    WHERE id = p_check_in_id AND clinic_id = p_clinic_id
      AND consult_notify_status IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    -- 경합(다른 txn 이 방금 claim) — 멱등
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'race');
  END IF;

  -- VG1 durable enqueue — 동일 txn. ON CONFLICT(event_id) DO NOTHING(멱등).
  --   next_attempt_at = now()+90s: [확정] EF 인라인 best-effort 발송에 first-shot 유예 →
  --   worker(분당)가 인라인 발송과 동시에 claim/재발송하는 race 방지(VG3 double-send 가드). 인라인 실패 시 worker 가 90s 후 인수.
  INSERT INTO public.consult_notify_outbox
    (event_id, check_in_id, clinic_id, channel, inflow, consultant_id, payload, next_attempt_at)
  VALUES (
    p_check_in_id::TEXT, p_check_in_id, p_clinic_id, p_channel, p_inflow, v_ci.consultant_id,
    jsonb_build_object(
      'check_in_id', p_check_in_id,
      'clinic_id',   p_clinic_id,
      'inflow',      p_inflow
    ),
    now() + INTERVAL '90 seconds'
  )
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_enqueued = ROW_COUNT;

  SELECT id INTO v_outbox_id
    FROM public.consult_notify_outbox
    WHERE event_id = p_check_in_id::TEXT;

  -- VG1: claim 성공했는데 outbox 행 부재 = silent gap 재생성 → 예외로 전체 롤백([확정]과 함께 실패).
  IF v_outbox_id IS NULL THEN
    RAISE EXCEPTION 'consult_notify enqueue failed: outbox row absent after insert (check_in=%)', p_check_in_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'claimed', true,
    'enqueued', (v_enqueued = 1),
    'outbox_id', v_outbox_id
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_consult_notify(UUID,UUID,TEXT,TEXT,UUID) IS
  'T-20260806-CONSULTCONFIRM-SLACK-DECOUPLE VG1: [확정] claim(check_ins.consult_notify_status NULL→sending) + '
  'consult_notify_outbox enqueue 를 단일 txn 원자화. enqueue 실패 시 RAISE→롤백(claim 무효). '
  'notify 실패는 이 함수 밖(dispatcher) 이므로 [확정] 성공(claimed=true)을 전파하지 않음.';

-- ══════════════════════════════════════════════════════════════════
-- 4) VG4 — DLQ 신규 → 슬랙 #infra-alerts 알람 (alert_dopamine_callback_dlq 미러)
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
           format('%s(att=%s,%s)', left(event_id, 8), attempts, COALESCE(error_class,'?')), ', '
         )
    INTO v_sample
    FROM (
      SELECT event_id, attempts, error_class
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
          ':rotating_light: *[풋CRM] 상담대기방 발송 DLQ 신규 %s건* — %s. '
          || '상담 배정은 확정됨(claim 영속)·알림만 미발송. channel_not_found=채널 재배선 필요. '
          || '확인: consult_notify_outbox WHERE dlq=true. (%s)',
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
  'T-20260806-CONSULTCONFIRM-SLACK-DECOUPLE VG4: DLQ 신규(dlq_alerted=false) 건 슬랙 #infra-alerts 배치 알람. '
  'webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback. 알람 후 dlq_alerted=true.';

-- ══════════════════════════════════════════════════════════════════
-- 5) VG2 — pg_cron worker: due/stuck claim → attempts++/backoff 선반영 → dispatcher EF 호출
--    (process_dopamine_callback_outbox 미러. backoff 1·2·4·8·16·32·60min.)
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

  -- VG4: DLQ 신규 알람 (EF가 직전 틱에 set 한 dlq 건 포함)
  PERFORM public.alert_consult_notify_dlq();

  RETURN jsonb_build_object(
    'ok', true, 'claimed', v_claimed,
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.process_consult_notify_outbox() IS
  'T-20260806-CONSULTCONFIRM-SLACK-DECOUPLE VG2: outbox worker(분당). due/stuck claim → attempts++/backoff 선반영 '
  '→ consult-notify-dispatch EF 호출 → DLQ 알람. backoff 1·2·4·8·16·32·60min, attempts>=7 시 dispatcher 가 dlq.';

-- pg_cron 등록 (재실행 안전)
SELECT cron.unschedule('foot-consult-notify-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-consult-notify-worker');

SELECT cron.schedule(
  'foot-consult-notify-worker',
  '* * * * *',  -- 분당 1회
  $$ SELECT public.process_consult_notify_outbox() $$
);

COMMIT;

-- POST-APPLY CHECK
-- [ ] to_regclass('public.consult_notify_outbox') IS NOT NULL
-- [ ] uq_consult_notify_outbox_event UNIQUE 존재 (VG3)
-- [ ] enqueue_consult_notify / process_consult_notify_outbox / alert_consult_notify_dlq 함수 3종 존재
-- [ ] cron.job 에 'foot-consult-notify-worker' 등록
-- [ ] chk_check_ins_consult_notify_status 가 'failed' 포함(3값)

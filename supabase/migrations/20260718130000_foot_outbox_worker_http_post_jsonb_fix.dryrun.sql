-- DRY-RUN (No-Persistence): FIX-REQUEST D1 — outbox worker net.http_post body jsonb 수정
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): 두 함수 재정의 후 net.http_post body 캐스트(::TEXT) 제거 검증.
--   · net.http_post 실호출은 dryrun 금지(실 HTTP) → 정의(pg_get_functiondef) 정적 검증으로 대체.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)가 별 txn 에서
--     함수 def 의 ::TEXT 잔존/부재를 재확인.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
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
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'process_dopamine_callback_outbox: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/dopamine-callback-dispatch';
  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );
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
      body    := jsonb_build_object('outbox_id', v_row.id, 'mode', v_mode)
    );
  END LOOP;
  PERFORM public.alert_dopamine_callback_dlq();
  RETURN jsonb_build_object(
    'ok', true, 'mode', v_mode, 'claimed', v_claimed,
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

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
  IF v_count = 0 THEN RETURN; END IF;
  BEGIN
    SELECT decrypted_secret INTO v_webhook FROM vault.decrypted_secrets
      WHERE name = 'slack_infra_alerts_webhook_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
  END;
  IF v_webhook IS NULL OR v_webhook = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_webhook FROM vault.decrypted_secrets
        WHERE name = 'slack_ops_webhook_url' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
    END;
  END IF;
  SELECT string_agg(format('%s/%s(att=%s)', event_type, left(event_id, 8), attempts), ', ')
    INTO v_sample
    FROM (
      SELECT event_type, event_id, attempts FROM public.dopamine_callback_outbox
        WHERE dlq = true AND dlq_alerted = false ORDER BY created_at LIMIT 10
    ) s;
  IF v_webhook IS NOT NULL AND v_webhook <> '' THEN
    PERFORM net.http_post(
      url     := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'text', format(
          ':rotating_light: *[풋CRM] 도파민 콜백 DLQ 신규 %s건* — %s. '
          || '재시도 소진/영구실패. 확인: dopamine_callback_outbox WHERE dlq=true. (%s)',
          v_count, COALESCE(v_sample, '(상세 없음)'),
          to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS KST')
        )
      )
    );
  ELSE
    RAISE LOG 'alert_dopamine_callback_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;
  UPDATE public.dopamine_callback_outbox SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

-- ── in-txn assertion ────────────────────────────────────────────────
DO $chk$
BEGIN
  -- (a) 두 함수 실존
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_dopamine_callback_outbox') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: process_dopamine_callback_outbox() 미생성';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'alert_dopamine_callback_dlq') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: alert_dopamine_callback_dlq() 미생성';
  END IF;
  -- (b) worker: net.http_post body 캐스트(::TEXT) 완전 제거 확인
  IF pg_get_functiondef('public.process_dopamine_callback_outbox()'::regprocedure) LIKE '%::TEXT%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: worker 정의에 ::TEXT 잔존 (body jsonb 수정 미반영)';
  END IF;
  -- (c) worker: body 를 jsonb_build_object 로 전달(named-arg) 확인
  IF pg_get_functiondef('public.process_dopamine_callback_outbox()'::regprocedure)
       NOT LIKE '%body := jsonb_build_object(''outbox_id''%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: worker body jsonb 전달 미확인';
  END IF;
  -- (d) alert: ::TEXT 완전 제거 확인
  IF pg_get_functiondef('public.alert_dopamine_callback_dlq()'::regprocedure) LIKE '%::TEXT%' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: alert 정의에 ::TEXT 잔존';
  END IF;
  RAISE NOTICE 'DRYRUN-OK: 두 net.http_post 콜사이트 body jsonb(::TEXT 제거) 검증 통과';
END;
$chk$;

ROLLBACK;

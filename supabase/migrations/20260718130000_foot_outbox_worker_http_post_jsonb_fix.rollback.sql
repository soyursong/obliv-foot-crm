-- ROLLBACK — FIX-REQUEST D1 (outbox worker net.http_post body jsonb 수정 역연산)
-- 20260718130000 이전 상태(20260603010000 원본 함수 본문, body ::TEXT 캐스트) 복원.
--
-- ⚠ 주의: 원복 시 net.http_post(body text) 시그니처 불일치 결함이 재현되어 worker cron 이
--   다시 100% 실패 상태로 돌아감(사전존재 P0). 순수 역연산 목적으로만 사용.
--   함수 본문 외 스키마/트리거/cron 무접촉이므로 CREATE OR REPLACE 2건으로 원복 완결.

BEGIN;

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
      body    := jsonb_build_object('outbox_id', v_row.id, 'mode', v_mode)::TEXT
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
      )::TEXT
    );
  ELSE
    RAISE LOG 'alert_dopamine_callback_dlq: webhook 미설정 — DLQ % 건 알람 생략', v_count;
  END IF;
  UPDATE public.dopamine_callback_outbox SET dlq_alerted = true, updated_at = now()
    WHERE dlq = true AND dlq_alerted = false;
END;
$$;

COMMIT;

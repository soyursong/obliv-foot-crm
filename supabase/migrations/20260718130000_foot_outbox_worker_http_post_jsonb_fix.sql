-- T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE / FIX-REQUEST D1 (supervisor NO-GO)
-- 사전존재 P0 인프라 결함 수정 — outbox worker net.http_post 시그니처 불일치.
--
-- 근인(supervisor evidence, prod 실측 dev-foot 2026-07-18 재확인):
--   설치 pg_net 시그니처 = net.http_post(url text, body jsonb DEFAULT '{}',
--       params jsonb DEFAULT '{}', headers jsonb DEFAULT '{...}', timeout_milliseconds int DEFAULT 5000)
--     → body 는 **jsonb**.
--   그러나 20260603010000 의 두 net.http_post 콜사이트가 body 를 `::TEXT` 로 캐스트 전달
--     → `net.http_post(url => text, headers => jsonb, body => text) does not exist` (매틱 롤백).
--   증거: cron.job_run_details jobid=12(foot-dopamine-callback-worker) 2880/2880 failed(2일),
--         최초실패 2026-06-30 03:11 · outbox 167행 status=pending attempts=0 고착(sent 0/dlq 0).
--   ⇒ foot→dopamine 콜백(process_status 축 + 본 티켓 stage 축) 단 1건도 성사된 적 없음.
--
-- 수정: 두 함수의 net.http_post body 인자를 `::TEXT` 캐스트 없이 jsonb 로 전달.
--   · public.process_dopamine_callback_outbox()  (worker → dopamine-callback-dispatch)
--   · public.alert_dopamine_callback_dlq()        (DLQ → slack webhook) — 동일 결함 예방 동반수정
--   named-arg(url/headers/body) 로 호출 → 설치 시그니처(params/timeout default)와 정합.
--   함수 body 외 로직/backoff/claim/cron 스케줄 무변경.
--
-- ADDITIVE/idempotent: CREATE OR REPLACE FUNCTION 2건 (함수 본문 교체만). 스키마/컬럼/제약/트리거/
--   cron 등록 무접촉. 기존 outbox 167 pending 행은 다음 틱부터 정상 claim(attempts++) 진행.
-- 롤백: 20260718130000_foot_outbox_worker_http_post_jsonb_fix.rollback.sql (구 ::TEXT 본문 복원)
-- dry-run: 20260718130000_foot_outbox_worker_http_post_jsonb_fix.dryrun.sql (No-Persistence)
-- 작성: dev-foot / 2026-07-18 / FIX-REQUEST D1

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) process_dopamine_callback_outbox() — worker (net.http_post body → jsonb)
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
    -- FIX D1: body 를 jsonb 로 전달(구 ::TEXT 캐스트 제거) — 설치 pg_net(body jsonb) 시그니처 정합.
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'X-Internal-Cron', v_cron_secret
      ),
      body    := jsonb_build_object('outbox_id', v_row.id, 'mode', v_mode)
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
  '→ dopamine-callback-dispatch EF 호출 → DLQ 알람. backoff 1·2·4·8·16·32·60min. '
  'FIX D1(2026-07-18): net.http_post body jsonb(구 ::TEXT 제거) — 설치 pg_net 시그니처 정합.';

-- ══════════════════════════════════════════════════════════════════
-- 2) alert_dopamine_callback_dlq() — DLQ 알람 (net.http_post body → jsonb)
--    동일 ::TEXT 결함 보유 → webhook 설정+DLQ 발생 시 잠재 실패. 예방 동반수정.
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
    -- FIX D1: body 를 jsonb 로 전달(구 ::TEXT 캐스트 제거) — 설치 pg_net(body jsonb) 시그니처 정합.
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
      )
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
  '알람 후 dlq_alerted=true. webhook=vault slack_infra_alerts_webhook_url → slack_ops_webhook_url fallback. '
  'FIX D1(2026-07-18): net.http_post body jsonb(구 ::TEXT 제거).';

COMMIT;

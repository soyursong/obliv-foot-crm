-- ============================================================
-- T-20260525-foot-MESSAGING-V1 S2 롤백
-- 20260527100000_messaging_s2_ops_data.sql 역순 롤백
-- ============================================================
-- 주의: vault secrets (supabase_project_url, supabase_anon_key,
--       internal_cron_secret, solapi_api_key_b4dc0de5, solapi_secret_b4dc0de5)
--       는 별도 psql 스크립트로 삭제해야 함 (이 파일에 민감 정보 비포함)
-- ============================================================

BEGIN;

-- STEP 1: pg_cron morning + retry 제거
DO $$
BEGIN
  PERFORM cron.unschedule('foot-notif-reminder-morning');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-notif-retry-failed');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- STEP 2: notify_reservation_messaging() S1 원본으로 복원
-- (S1 상태: 'reserved' 체크, 메시징 비활성 클리닉 early return 없음)
CREATE OR REPLACE FUNCTION public.notify_reservation_messaging()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'vault'
AS $$
DECLARE
  v_event_type TEXT;
  v_ef_url     TEXT;
  v_secret     TEXT;
  v_anon       TEXT;
  v_log_id     UUID;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'reserved' THEN
    v_event_type := 'resv_confirm';
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(OLD.status, '') <> 'reserved'
    AND NEW.status = 'reserved'
  THEN
    v_event_type := 'resv_confirm';
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_ef_url  FROM vault.decrypted_secrets WHERE name = 'supabase_project_url'  LIMIT 1;
  SELECT decrypted_secret INTO v_secret  FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret'  LIMIT 1;
  SELECT decrypted_secret INTO v_anon    FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'     LIMIT 1;

  IF v_ef_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    RAISE WARNING 'notify_reservation_messaging: vault secret 미설정 → skip';
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_logs
    (clinic_id, customer_id, reservation_id, event_type, channel, recipient_phone, status)
  VALUES
    (NEW.clinic_id, NEW.customer_id, NEW.id, v_event_type, 'sms', NULL, 'pending')
  RETURNING id INTO v_log_id;

  PERFORM net.http_post(
    url     := v_ef_url || '/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'X-Internal-Cron', v_secret,
      'Authorization',   'Bearer ' || v_anon
    ),
    body    := jsonb_build_object(
      'event_type',     v_event_type,
      'reservation_id', NEW.id,
      'clinic_id',      NEW.clinic_id,
      'customer_id',    NEW.customer_id,
      'retry_log_id',   v_log_id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_reservation_messaging error: % %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_reservation_messaging() IS
  'T-20260525-foot-MESSAGING-V1: 예약 확정 시 SMS 발송 트리거 함수 — S2 롤백 (S1 상태 복원, status=reserved)';

-- STEP 3: notify_reminders_batch() S1 원본으로 복원
CREATE OR REPLACE FUNCTION public.notify_reminders_batch(
  p_event_type TEXT,
  p_dry_run    BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_target_date DATE;
  v_reservation RECORD;
  v_call_count  INT := 0;
  v_skip_count  INT := 0;
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_anon_jwt    TEXT;
  v_result      JSONB;
BEGIN
  IF p_event_type = 'resv_reminder_d1' THEN
    v_target_date := (now() AT TIME ZONE 'Asia/Seoul')::DATE + INTERVAL '1 day';
  ELSIF p_event_type = 'resv_reminder_morning' THEN
    v_target_date := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
  ELSE
    RAISE EXCEPTION 'notify_reminders_batch: unsupported event_type=%', p_event_type;
  END IF;

  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  ) || '/functions/v1/send-notification';

  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret')
  );

  v_anon_jwt := public.get_vault_secret('supabase_anon_key');

  FOR v_reservation IN
    SELECT r.id AS reservation_id, r.clinic_id, r.customer_id, c.phone AS customer_phone
    FROM public.reservations r
    JOIN public.customers c ON c.id = r.customer_id
    JOIN public.clinic_messaging_capability cap ON cap.clinic_id = r.clinic_id
    WHERE r.reservation_date = v_target_date
      AND r.status = 'reserved'
      AND cap.enabled = TRUE
      AND c.sms_opt_in = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_logs nl
        WHERE nl.reservation_id = r.id
          AND nl.event_type = p_event_type
          AND nl.status = 'sent'
      )
  LOOP
    IF p_dry_run THEN v_skip_count := v_skip_count + 1; CONTINUE; END IF;
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_anon_jwt,
        'X-Internal-Cron', v_cron_secret
      ),
      body    := jsonb_build_object(
        'event_type',      p_event_type,
        'reservation_id',  v_reservation.reservation_id,
        'clinic_id',       v_reservation.clinic_id,
        'customer_id',     v_reservation.customer_id,
        'recipient_phone', v_reservation.customer_phone
      )
    );
    v_call_count := v_call_count + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'event_type',    p_event_type,
    'target_date',   v_target_date,
    'dry_run',       p_dry_run,
    'dispatched',    v_call_count,
    'skipped_dry',   v_skip_count,
    'run_at',        to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.notify_reminders_batch(TEXT, BOOLEAN) IS
  'T-20260525-foot-MESSAGING-V1: 리마인더 배치 발송 — S2 롤백 (S1 상태 복원, status=reserved)';

-- STEP 4: 송도 clinic_messaging_capability 삭제
DELETE FROM public.clinic_messaging_capability
 WHERE clinic_id = 'b4dc0de5-f007-4a57-8888-aabbccddeeff'::UUID;

-- STEP 5: 송도 클리닉 삭제 (cascade로 연관 데이터 함께 삭제)
-- 주의: 송도 클리닉에 customers/reservations 데이터가 있으면 FK 오류
--       실제 운영 데이터 입력 전에 롤백해야 안전
DELETE FROM public.clinics
 WHERE id = 'b4dc0de5-f007-4a57-8888-aabbccddeeff'::UUID;

COMMIT;

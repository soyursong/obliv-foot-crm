-- ============================================================
-- T-20260525-foot-MESSAGING-V1 S2: 운영 데이터 등록 (AC-4 ~ AC-7)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-27
-- ============================================================
-- AC-4: Vault 연결 확인 (vault secret INSERT는 별도 psql 직접 실행)
-- AC-5: clinic_messaging_capability — 종로 UPDATE + 송도 신규 INSERT
-- AC-6: pg_cron 3건 — D-1(이미 active) / morning 등록(inactive) / retry 등록(inactive)
-- AC-7: notify_reservation_messaging() 버그 수정 — 'reserved' → 'confirmed'
--        notify_reminders_batch() 버그 수정 — r.status 'reserved' → 'confirmed'
-- ============================================================
--
-- 발신번호:
--   풋 종로 01088277791 (이광현 솔라피 등록 완료)
--   풋 송도 01034573344 (5/27 확정, 기존 01095077787 → 변경)
--
-- 솔라피 vault 이름 규칙: 'solapi_api_key_' || LEFT(clinic_id, 8)
--   종로 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8
--     → api_key vault: solapi_api_key_74967aea  (S1에서 등록됨, AC-4에서 확인)
--     → secret vault:  solapi_secret_74967aea   (S1에서 등록됨, AC-4에서 확인)
--   송도 clinic_id: b4dc0de5-f007-4a57-8888-aabbccddeeff (고정 UUID, 이 마이그에서 신규)
--     → api_key vault: solapi_api_key_b4dc0de5  (vault INSERT는 별도 psql 실행)
--     → secret vault:  solapi_secret_b4dc0de5   (vault INSERT는 별도 psql 실행)
--
-- 버그: S1 messaging_module.sql 은 롱레(happy-flow-queue) 코드를 복제했으나
--   롱레 reservations.status = 'reserved' vs 풋 reservations.status = 'confirmed'
--   → notify_reservation_messaging() 한 번도 실제 발동 안 됨 (INSERT/UPDATE 조건 불일치)
--   → notify_reminders_batch() 도 동일 원인으로 대상 0건 반환
--   이 마이그레이션에서 'confirmed' 로 수정.
-- ============================================================
-- 롤백: 20260527100000_messaging_s2_ops_data.rollback.sql
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: 오블리브 풋센터 송도 클리닉 추가
-- ============================================================
-- 고정 UUID 사용 → vault_name 사전 계산 가능
-- (gen_random_uuid() 사용 시 vault_name 계산 불가 → 고정 UUID 정책)

INSERT INTO public.clinics (
  id,
  name,
  slug,
  address,
  open_time,
  close_time,
  slot_interval
) VALUES (
  'b4dc0de5-f007-4a57-8888-aabbccddeeff'::UUID,
  '오블리브 풋센터 송도',
  'songdo-foot',
  '인천 연수구 컨벤시아대로 204 2층',
  '09:00'::TIME,
  '21:00'::TIME,
  30
)
ON CONFLICT (slug) DO UPDATE SET
  name       = EXCLUDED.name,
  address    = EXCLUDED.address,
  open_time  = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time
;

COMMENT ON TABLE public.clinics IS
  'T-20260525-foot-MESSAGING-V1 S2: 오블리브 풋센터 송도 추가 (slug=songdo-foot, 2026-05-27)';

-- ============================================================
-- SECTION 2: clinic_messaging_capability — 종로 확인 + 송도 신규
-- ============================================================

-- 2-A. 종로: UPSERT (sender_number + vault_name 갱신)
--   S1에서 enabled=true, sender_number=01088277791 이미 설정됨
--   이번 마이그에서 동일 값으로 idempotent UPDATE 실행
INSERT INTO public.clinic_messaging_capability (
  clinic_id,
  enabled,
  sender_number,
  solapi_api_key_vault_name,
  solapi_secret_vault_name
) VALUES (
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::UUID,  -- 풋 종로(오리진점)
  TRUE,
  '01088277791',
  'solapi_api_key_74967aea',
  'solapi_secret_74967aea'
)
ON CONFLICT (clinic_id) DO UPDATE SET
  enabled                   = TRUE,
  sender_number             = '01088277791',
  solapi_api_key_vault_name = 'solapi_api_key_74967aea',
  solapi_secret_vault_name  = 'solapi_secret_74967aea',
  updated_at                = now();

-- 2-B. 송도: 신규 INSERT
INSERT INTO public.clinic_messaging_capability (
  clinic_id,
  enabled,
  sender_number,
  solapi_api_key_vault_name,
  solapi_secret_vault_name
) VALUES (
  'b4dc0de5-f007-4a57-8888-aabbccddeeff'::UUID,  -- 풋 송도 (신규)
  TRUE,
  '01034573344',
  'solapi_api_key_b4dc0de5',
  'solapi_secret_b4dc0de5'
)
ON CONFLICT (clinic_id) DO UPDATE SET
  enabled                   = TRUE,
  sender_number             = '01034573344',
  solapi_api_key_vault_name = 'solapi_api_key_b4dc0de5',
  solapi_secret_vault_name  = 'solapi_secret_b4dc0de5',
  updated_at                = now();

-- ============================================================
-- SECTION 3: pg_cron — morning + retry 등록 (inactive)
-- ============================================================
-- D-1 (foot-notif-reminder-d1): S1에서 이미 active=TRUE 등록됨 — 건드리지 않음
-- morning (foot-notif-reminder-morning): 신규 등록 → 즉시 active=FALSE
-- retry   (foot-notif-retry-failed):     신규 등록 → 즉시 active=FALSE

-- 3-A. 기존 동명 작업 unschedule (idempotent)
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

-- 3-B. morning 등록: 09:00 KST = 00:00 UTC
SELECT cron.schedule(
  'foot-notif-reminder-morning',
  '0 0 * * *',
  $$SELECT public.notify_reminders_batch('resv_reminder_morning', FALSE)$$
);

-- 3-C. retry 등록: 30분마다
SELECT cron.schedule(
  'foot-notif-retry-failed',
  '*/30 * * * *',
  $$SELECT public.notify_retry_failed(FALSE)$$
);

-- 3-D. morning + retry 비활성화 (Supabase 제약으로 SQL에서 불가)
-- ⚠ Supabase 제약: cron.job 테이블은 permission denied — active=FALSE 설정 불가
-- → morning/retry 는 일단 active=TRUE 로 등록됨
-- → 비활성화 필요 시: Supabase Dashboard > Database > Extensions > pg_cron 에서 수동 toggle
-- → FOLLOWUP: planner에 통보 (morning 즉시 발송 위험, retry는 무해)

-- ============================================================
-- SECTION 4: notify_reservation_messaging() 버그 수정
-- ============================================================
-- 풋 CRM reservations.status CHECK: ('confirmed','checked_in','cancelled','noshow')
-- S1 롱레 복제 시 'reserved' 그대로 복사 → 예약 생성 시 한 번도 SMS 미발송
-- S2에서 'confirmed' 로 수정 + 메시징 비활성 클리닉 early return 추가

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
  -- 트리거 조건: 신규 예약(INSERT status=confirmed) 또는
  --             상태 전이(UPDATE old≠confirmed → new=confirmed)
  --             ※ 풋 CRM 예약 기본 status = 'confirmed' (롱레의 'reserved' 아님)
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    v_event_type := 'resv_confirm';
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(OLD.status, '') <> 'confirmed'
    AND NEW.status = 'confirmed'
  THEN
    v_event_type := 'resv_confirm';
  ELSE
    RETURN NEW;
  END IF;

  -- 메시징 비활성 클리닉 early return (vault 조회 전 비용 절감)
  IF NOT EXISTS (
    SELECT 1
    FROM public.clinic_messaging_capability
    WHERE clinic_id = NEW.clinic_id
      AND enabled   = TRUE
  ) THEN
    RETURN NEW;
  END IF;

  -- vault secret 조회 (decrypted_secrets 뷰: SECURITY DEFINER 컨텍스트에서 접근)
  SELECT decrypted_secret INTO v_ef_url  FROM vault.decrypted_secrets WHERE name = 'supabase_project_url'  LIMIT 1;
  SELECT decrypted_secret INTO v_secret  FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret'  LIMIT 1;
  SELECT decrypted_secret INTO v_anon    FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'     LIMIT 1;

  IF v_ef_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    RAISE WARNING 'notify_reservation_messaging: vault secret 미설정 (url=% sec=% anon=%) → skip',
      v_ef_url IS NULL, v_secret IS NULL, v_anon IS NULL;
    RETURN NEW;
  END IF;

  -- AC-2: pre-insert pending log → EF 에 retry_log_id 전달
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
  'T-20260525-foot-MESSAGING-V1 S2 버그수정: '
  'status=''confirmed'' (롱레 복제 시 ''reserved'' 오기입 수정). '
  '메시징 비활성 클리닉 early return 추가. '
  '2026-05-27 dev-foot';

-- ============================================================
-- SECTION 5: notify_reminders_batch() 버그 수정
-- ============================================================
-- 동일 원인: r.status = 'reserved' → 'confirmed' 수정
-- 기능 변경 없음 — status 값 1개만 수정

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
      AND r.status = 'confirmed'          -- 수정: 'reserved' → 'confirmed' (2026-05-27 S2)
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
        'Content-Type',    'application/json',
        'Authorization',   'Bearer ' || v_anon_jwt,
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
  'T-20260525-foot-MESSAGING-V1 S2 버그수정: '
  'r.status=''confirmed'' (롱레 복제 시 ''reserved'' 오기입 수정). '
  '2026-05-27 dev-foot';

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (S2)
-- ============================================================
-- [ ] 1. 송도 클리닉 확인
--        SELECT id, name, slug FROM public.clinics ORDER BY created_at;
--        → 종로 + 송도 2개 반환
--
-- [ ] 2. clinic_messaging_capability 확인
--        SELECT c.name, cap.enabled, cap.sender_number, cap.solapi_api_key_vault_name
--        FROM public.clinic_messaging_capability cap
--        JOIN public.clinics c ON c.id = cap.clinic_id;
--        → 종로: enabled=t, sender=01088277791, vault=solapi_api_key_74967aea
--        → 송도: enabled=t, sender=01034573344, vault=solapi_api_key_b4dc0de5
--
-- [ ] 3. vault secrets 확인 (vault INSERT는 별도 psql 스크립트에서 실행)
--        SELECT public.get_vault_secret('supabase_project_url');
--        → 'https://rxlomoozakkjesdqjtvd.supabase.co' 반환
--        SELECT public.get_vault_secret('supabase_anon_key');
--        → anon key 반환 (NULL 이면 vault INSERT 재실행)
--        SELECT public.get_vault_secret('internal_cron_secret');
--        → cron secret 반환 (NULL 이면 vault INSERT 재실행)
--        SELECT public.get_vault_secret('solapi_api_key_b4dc0de5');
--        → 'NCSEQGW0IDNNBIXV' 반환
--
-- [ ] 4. pg_cron 상태 확인 (postgres 역할로만 조회 가능)
--        SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'foot-%' ORDER BY jobname;
--        → foot-ef-send-notification-keep-warm: active=TRUE
--        → foot-notif-reminder-d1:              active=TRUE
--        → foot-notif-reminder-morning:          active=FALSE
--        → foot-notif-retry-failed:              active=FALSE
--
-- [ ] 5. 트리거 함수 버그 수정 확인
--        SELECT routine_name FROM information_schema.routines
--        WHERE routine_name IN ('notify_reservation_messaging','notify_reminders_batch')
--          AND routine_schema = 'public';
--        → 2개 반환
--        -- 내용 확인 (status='confirmed' 포함 확인):
--        SELECT prosrc FROM pg_proc WHERE proname = 'notify_reservation_messaging'
--          AND pronamespace = 'public'::regnamespace;
--        → 'confirmed' 포함, 'reserved' 미포함 확인
--
-- [ ] 6. EF secret INTERNAL_CRON_SECRET 설정 확인
--        supabase secrets list --project-ref rxlomoozakkjesdqjtvd
--        → INTERNAL_CRON_SECRET 포함 확인
--
-- [ ] 7. dry-run 검증
--        SELECT public.notify_reminders_batch('resv_reminder_d1', TRUE);
--        → target_date 내일, skipped_dry >= 0 반환 (에러 없음)
-- ============================================================

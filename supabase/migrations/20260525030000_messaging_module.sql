-- ============================================================
-- T-20260525-foot-MESSAGING-V1: 풋 메시징 모듈 1차 — 롱레 복제
-- 롱레 happy-flow-queue 마이그 4종 + hotfix 363bc03 통합 복제
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260525030000_messaging_module.rollback.sql
-- 작성: dev-foot / 2026-05-25
-- ============================================================
-- 포함 마이그레이션 (happy-flow-queue 원본 기준):
--   20260520100000_messaging_capability.sql
--   20260521200000_notification_templates.sql
--   20260522230000_messaging_rls_admin_fix.sql   ← FINAL RLS state
--   20260523100000_admin_save_messaging_config.sql (v2 final)
--   20260524000000_messaging_sla_opt.sql          ← AC-2 trigger
--   20260524130000_messaging_auth_header_fix.sql  ← hotfix v4 final
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 0: 헬퍼 함수 alias (foot → crm 함수명 호환)
-- ============================================================
-- foot-crm은 current_user_role() / current_user_clinic_id() 를 사용.
-- happy-flow-queue RLS/RPC 는 get_user_role() / get_user_clinic_id() 를 참조하므로
-- alias 래퍼를 생성하여 호환성 확보. SECURITY DEFINER 불필요 (단순 위임).

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role();
$$;

COMMENT ON FUNCTION public.get_user_role() IS
  'T-20260525-foot-MESSAGING-V1: alias — current_user_role() 래퍼 (happy-flow-queue 호환)';

CREATE OR REPLACE FUNCTION public.get_user_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_clinic_id();
$$;

COMMENT ON FUNCTION public.get_user_clinic_id() IS
  'T-20260525-foot-MESSAGING-V1: alias — current_user_clinic_id() 래퍼 (happy-flow-queue 호환)';

-- updated_at 자동 갱신 트리거 함수 (messaging 테이블용)
-- set_updated_at() 이 이미 존재하면 재사용; 없으면 생성.
CREATE OR REPLACE FUNCTION public.moddatetime_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.moddatetime_updated_at() IS
  'T-20260525-foot-MESSAGING-V1: updated_at 자동 갱신 트리거 함수 (messaging 테이블용)';

-- ============================================================
-- SECTION 1: clinic_messaging_capability 테이블
-- ============================================================
-- 클리닉별 메시징 기능 활성화 여부를 관리.
-- enabled = TRUE 인 클리닉에 한해 SMS 발송 로직이 동작함.

CREATE TABLE IF NOT EXISTS public.clinic_messaging_capability (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                 UUID        NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  enabled                   BOOLEAN     NOT NULL DEFAULT FALSE,
  solapi_api_key_vault_name TEXT,
  solapi_secret_vault_name  TEXT,
  sender_number             TEXT,
  send_start_hour           SMALLINT    NOT NULL DEFAULT 9  CHECK (send_start_hour BETWEEN 0 AND 23),
  send_end_hour             SMALLINT    NOT NULL DEFAULT 21 CHECK (send_end_hour BETWEEN 0 AND 23),
  kakao_channel_id          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_msg_cap_clinic_id
  ON public.clinic_messaging_capability(clinic_id);

DROP TRIGGER IF EXISTS trg_clinic_msg_cap_updated_at ON public.clinic_messaging_capability;
CREATE TRIGGER trg_clinic_msg_cap_updated_at
  BEFORE UPDATE ON public.clinic_messaging_capability
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime_updated_at();

COMMENT ON TABLE  public.clinic_messaging_capability IS
  'T-20260525-foot-MESSAGING-V1: 클리닉별 메시징 활성화 여부';
COMMENT ON COLUMN public.clinic_messaging_capability.enabled IS
  'TRUE = SMS 발송 활성; FALSE = 비활성 (기본값)';

-- ============================================================
-- SECTION 2: notification_templates 테이블
-- ============================================================
-- 이벤트 유형별 SMS/알림 메시지 템플릿 저장.

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        REFERENCES public.clinics(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  channel     TEXT        NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','kakao','push')),
  template    TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_tmpl_clinic_event_channel UNIQUE (clinic_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notif_tmpl_clinic_id
  ON public.notification_templates(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notif_tmpl_event_type
  ON public.notification_templates(event_type);

DROP TRIGGER IF EXISTS trg_notif_tmpl_updated_at ON public.notification_templates;
CREATE TRIGGER trg_notif_tmpl_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime_updated_at();

COMMENT ON TABLE  public.notification_templates IS
  'T-20260525-foot-MESSAGING-V1: 이벤트별 SMS/알림 템플릿';
COMMENT ON COLUMN public.notification_templates.event_type IS
  'resv_confirm | resv_reminder_d1 | resv_reminder_morning | resv_cancel 등';
COMMENT ON COLUMN public.notification_templates.channel IS
  'sms | kakao | push';

-- ============================================================
-- SECTION 3: notification_logs 테이블 (인덱스 포함)
-- ============================================================
-- 모든 발송 시도와 그 결과를 기록. 재시도 로직의 핵심 상태 저장소.

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID        REFERENCES public.clinics(id) ON DELETE SET NULL,
  customer_id      UUID        REFERENCES public.customers(id) ON DELETE SET NULL,
  reservation_id   UUID        REFERENCES public.reservations(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL,
  channel          TEXT        NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','kakao','push')),
  recipient_phone  TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','sent','failed','cancelled')),
  provider_msg_id  TEXT,
  error_message    TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기본 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_notif_logs_clinic_id
  ON public.notification_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notif_logs_reservation_id
  ON public.notification_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_notif_logs_customer_id
  ON public.notification_logs(customer_id);
-- 재시도 쿼리용: status + created_at (notify_retry_failed 에서 사용)
CREATE INDEX IF NOT EXISTS idx_notif_logs_status_created
  ON public.notification_logs(status, created_at)
  WHERE status IN ('failed', 'pending');
-- 중복 발송 방지: reservation_id + event_type + status 조합
CREATE INDEX IF NOT EXISTS idx_notif_logs_resv_event_status
  ON public.notification_logs(reservation_id, event_type, status);

DROP TRIGGER IF EXISTS trg_notif_logs_updated_at ON public.notification_logs;
CREATE TRIGGER trg_notif_logs_updated_at
  BEFORE UPDATE ON public.notification_logs
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime_updated_at();

COMMENT ON TABLE  public.notification_logs IS
  'T-20260525-foot-MESSAGING-V1: 발송 이력 및 상태 추적';
COMMENT ON COLUMN public.notification_logs.status IS
  'pending=발송대기 | sent=발송성공 | failed=발송실패 | cancelled=취소';
COMMENT ON COLUMN public.notification_logs.provider_msg_id IS
  'Solapi 등 외부 발송 공급자로부터 반환된 메시지 ID';

-- ============================================================
-- SECTION 4: notification_opt_outs 테이블
-- ============================================================
-- 수신 거부 명시 고객 기록. sms_opt_in = FALSE 와 이중 방어막.

CREATE TABLE IF NOT EXISTS public.notification_opt_outs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        REFERENCES public.clinics(id) ON DELETE CASCADE,
  customer_id  UUID        REFERENCES public.customers(id) ON DELETE CASCADE,
  phone        TEXT        NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason       TEXT,
  CONSTRAINT uq_notif_optout_clinic_phone UNIQUE (clinic_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_notif_optout_clinic_id
  ON public.notification_opt_outs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notif_optout_customer_id
  ON public.notification_opt_outs(customer_id);
CREATE INDEX IF NOT EXISTS idx_notif_optout_phone
  ON public.notification_opt_outs(phone);

COMMENT ON TABLE public.notification_opt_outs IS
  'T-20260525-foot-MESSAGING-V1: SMS/알림 수신 거부 명단';

-- ============================================================
-- SECTION 5: customers.sms_opt_in 컬럼 추가
-- ============================================================
-- 수신 동의 컬럼. 기본값 TRUE (기존 고객 발송 유지).
-- notify_reminders_batch 에서 sms_opt_in = TRUE 필터로 사용.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.customers.sms_opt_in IS
  'T-20260525-foot-MESSAGING-V1: SMS 수신 동의 여부 (TRUE=동의, FALSE=거부). 기본값 TRUE.';

-- ============================================================
-- SECTION 6: RLS 정책 (FINAL state — 20260522230000 rls_admin_fix 반영)
-- ============================================================

-- 6-A. clinic_messaging_capability
ALTER TABLE public.clinic_messaging_capability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_cap_select ON public.clinic_messaging_capability;
CREATE POLICY notif_cap_select ON public.clinic_messaging_capability
  FOR SELECT
  TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

DROP POLICY IF EXISTS notif_cap_write ON public.clinic_messaging_capability;
CREATE POLICY notif_cap_write ON public.clinic_messaging_capability
  FOR ALL
  TO authenticated
  USING  (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- 6-B. notification_templates
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_tmpl_select ON public.notification_templates;
CREATE POLICY notif_tmpl_select ON public.notification_templates
  FOR SELECT
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    OR clinic_id IS NULL  -- 공용(전역) 템플릿
  );

DROP POLICY IF EXISTS notif_tmpl_write ON public.notification_templates;
CREATE POLICY notif_tmpl_write ON public.notification_templates
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  );

-- 6-C. notification_logs
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_logs_select ON public.notification_logs;
CREATE POLICY notif_logs_select ON public.notification_logs
  FOR SELECT
  TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

-- 로그 INSERT/UPDATE 는 서버사이드(Edge Function, trigger, cron) 에서만 수행.
-- 일반 사용자 DML 불허 (서비스롤 또는 SECURITY DEFINER 함수 사용).

-- 6-D. notification_opt_outs
ALTER TABLE public.notification_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_optout_select ON public.notification_opt_outs;
CREATE POLICY notif_optout_select ON public.notification_opt_outs
  FOR SELECT
  TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

DROP POLICY IF EXISTS notif_optout_write ON public.notification_opt_outs;
CREATE POLICY notif_optout_write ON public.notification_opt_outs
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  );

-- ============================================================
-- SECTION 7: get_vault_secret RPC
-- ============================================================
-- 화이트리스트: solapi_* | internal_cron_* | supabase_*
-- 화이트리스트 이외의 secret name 은 NULL 반환 (정보 누출 방지).
-- SECURITY DEFINER → vault.decrypted_secrets 접근 가능.

CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- 화이트리스트 검증
  IF p_name NOT SIMILAR TO '(solapi_|internal_cron_|supabase_)%' THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = p_name
   LIMIT 1;

  RETURN v_secret;
END;
$$;

COMMENT ON FUNCTION public.get_vault_secret(TEXT) IS
  'T-20260525-foot-MESSAGING-V1: vault secret 조회 (화이트리스트: solapi_* | internal_cron_* | supabase_*)';

-- ============================================================
-- SECTION 8: admin_save_messaging_config RETURNS JSONB (FINAL v2)
-- ============================================================
-- 관리자 전용: 클리닉 메시징 설정(Solapi API 키/시크릿)을 vault 에 저장하고
-- clinic_messaging_capability.enabled 를 갱신.
-- vault 키 형식: 'solapi_api_key_' || LEFT(clinic_id::TEXT, 8)
--               'solapi_secret_'  || LEFT(clinic_id::TEXT, 8)

CREATE OR REPLACE FUNCTION public.admin_save_messaging_config(
  p_clinic_id     UUID,
  p_sender_number TEXT    DEFAULT NULL,  -- NULL = 기존값 유지
  p_enabled       BOOLEAN DEFAULT NULL,  -- NULL = 기존값 유지
  p_api_key       TEXT    DEFAULT NULL,  -- NULL / 빈 문자열 = 기존 Vault 유지
  p_api_secret    TEXT    DEFAULT NULL   -- NULL / 빈 문자열 = 기존 Vault 유지
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_role               TEXT;
  v_key_vault_name     TEXT;
  v_secret_vault_name  TEXT;
  v_existing_key_id    UUID;
  v_existing_sec_id    UUID;
  v_key_updated        BOOLEAN := FALSE;
  v_sec_updated        BOOLEAN := FALSE;
  v_sender_clean       TEXT;
BEGIN
  -- ── 권한 체크: admin only ─────────────────────────────────────
  v_role := public.get_user_role();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_save_messaging_config: role=% — admin 전용 함수입니다', COALESCE(v_role, 'NULL');
  END IF;

  -- ── sender_number 정규화 (비숫자 제거) ───────────────────────
  -- 하이픈·공백·플러스 등 제거해 일관된 형식으로 저장
  v_sender_clean := CASE
    WHEN p_sender_number IS NULL THEN NULL
    ELSE NULLIF(REGEXP_REPLACE(TRIM(p_sender_number), '[^0-9]', '', 'g'), '')
  END;

  -- ── Vault 이름 규칙 ───────────────────────────────────────────
  v_key_vault_name    := 'solapi_api_key_'  || LEFT(p_clinic_id::TEXT, 8);
  v_secret_vault_name := 'solapi_secret_'   || LEFT(p_clinic_id::TEXT, 8);

  -- ── API Key → Vault upsert ────────────────────────────────────
  IF p_api_key IS NOT NULL AND LENGTH(TRIM(p_api_key)) > 0 THEN
    SELECT id INTO v_existing_key_id
    FROM vault.secrets
    WHERE name = v_key_vault_name
    LIMIT 1;

    IF v_existing_key_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_key_id, TRIM(p_api_key), v_key_vault_name);
    ELSE
      PERFORM vault.create_secret(TRIM(p_api_key), v_key_vault_name);
    END IF;
    v_key_updated := TRUE;
  END IF;

  -- ── API Secret → Vault upsert ─────────────────────────────────
  IF p_api_secret IS NOT NULL AND LENGTH(TRIM(p_api_secret)) > 0 THEN
    SELECT id INTO v_existing_sec_id
    FROM vault.secrets
    WHERE name = v_secret_vault_name
    LIMIT 1;

    IF v_existing_sec_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_sec_id, TRIM(p_api_secret), v_secret_vault_name);
    ELSE
      PERFORM vault.create_secret(TRIM(p_api_secret), v_secret_vault_name);
    END IF;
    v_sec_updated := TRUE;
  END IF;

  -- ── clinic_messaging_capability upsert ───────────────────────
  INSERT INTO public.clinic_messaging_capability (
    clinic_id,
    enabled,
    sender_number,
    solapi_api_key_vault_name,
    solapi_secret_vault_name
  )
  VALUES (
    p_clinic_id,
    COALESCE(p_enabled, FALSE),
    v_sender_clean,
    CASE WHEN v_key_updated THEN v_key_vault_name ELSE NULL END,
    CASE WHEN v_sec_updated THEN v_secret_vault_name ELSE NULL END
  )
  ON CONFLICT (clinic_id) DO UPDATE SET
    -- p_enabled IS NOT NULL 일 때만 갱신 (NULL = 기존값 유지)
    enabled = CASE
      WHEN p_enabled IS NOT NULL THEN p_enabled
      ELSE clinic_messaging_capability.enabled
    END,
    -- 정규화된 sender_number 저장
    sender_number = CASE
      WHEN v_sender_clean IS NOT NULL THEN v_sender_clean
      ELSE clinic_messaging_capability.sender_number
    END,
    solapi_api_key_vault_name = CASE
      WHEN v_key_updated THEN v_key_vault_name
      ELSE clinic_messaging_capability.solapi_api_key_vault_name
    END,
    solapi_secret_vault_name = CASE
      WHEN v_sec_updated THEN v_secret_vault_name
      ELSE clinic_messaging_capability.solapi_secret_vault_name
    END,
    updated_at = now();

  -- 기존 sender_number에 하이픈이 있으면 정규화 (마이그레이션 실행 시 1회)
  UPDATE public.clinic_messaging_capability
  SET
    sender_number = REGEXP_REPLACE(sender_number, '[^0-9]', '', 'g'),
    updated_at    = now()
  WHERE
    clinic_id     = p_clinic_id
    AND sender_number IS NOT NULL
    AND sender_number ~ '[^0-9]';

  RAISE LOG 'admin_save_messaging_config v2: clinic=% sender=% (raw=%) enabled=% key_updated=% sec_updated=%',
    p_clinic_id, v_sender_clean, p_sender_number, p_enabled, v_key_updated, v_sec_updated;

  RETURN jsonb_build_object(
    'success',                 TRUE,
    'sender_number',           v_sender_clean,
    'enabled',                 p_enabled,
    'vault_key_name',          v_key_vault_name,
    'vault_sec_name',          v_secret_vault_name,
    'vault_key_saved',         v_key_updated,
    'vault_sec_saved',         v_sec_updated,
    'updated_at',              to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.admin_save_messaging_config(UUID, TEXT, BOOLEAN, TEXT, TEXT) IS
  'T-20260525-foot-MESSAGING-V1: 관리자용 메시징 설정 저장 (vault + capability) — v2 final. '
  'admin role 전용. DB + Vault 원자적 저장. '
  'p_api_key/p_api_secret 미입력 시 기존 Vault 값 유지. '
  'p_enabled NULL 시 기존값 유지. '
  'sender_number 비숫자 자동 제거 (정규화).';

-- ============================================================
-- SECTION 9: Solapi 발신번호 검증 컬럼 + validate_solapi_sender RPC
-- ============================================================

-- clinic_messaging_capability 에 검증 상태 컬럼 추가
ALTER TABLE public.clinic_messaging_capability
  ADD COLUMN IF NOT EXISTS solapi_validation_status     TEXT
    CHECK (solapi_validation_status IN ('unchecked','pending','verified','not_registered','api_unreachable'))
    DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS solapi_validation_request_id TEXT;

COMMENT ON COLUMN public.clinic_messaging_capability.solapi_validation_status IS
  'unchecked | pending | verified | not_registered | api_unreachable — Solapi 발신번호 등록/검증 상태';
COMMENT ON COLUMN public.clinic_messaging_capability.solapi_validation_request_id IS
  'Solapi 발신번호 검증 요청 ID (외부 폴링용)';

-- 발신번호 검증 요청 RPC
-- 실제 Solapi API 호출은 Edge Function 에서 수행; 이 함수는 상태를 'pending' 으로 전이.
CREATE OR REPLACE FUNCTION public.validate_solapi_sender(p_clinic_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        TEXT;
  v_caller_cid  UUID;
  v_request_id  TEXT;
BEGIN
  v_role       := public.get_user_role();
  v_caller_cid := public.get_user_clinic_id();

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'validate_solapi_sender: 권한 없음 (role=%)', v_role;
  END IF;

  IF v_caller_cid <> p_clinic_id THEN
    RAISE EXCEPTION 'validate_solapi_sender: 클리닉 불일치';
  END IF;

  -- 검증 요청 ID 생성 (임시 UUID; Edge Function이 Solapi 실제 요청 ID로 교체)
  v_request_id := gen_random_uuid()::TEXT;

  UPDATE public.clinic_messaging_capability
     SET solapi_validation_status     = 'pending',
         solapi_validation_request_id = v_request_id,
         updated_at                   = now()
   WHERE clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'validate_solapi_sender: clinic_messaging_capability 레코드 없음 (clinic_id=%)',
      p_clinic_id;
  END IF;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION public.validate_solapi_sender(UUID) IS
  'T-20260525-foot-MESSAGING-V1: Solapi 발신번호 검증 요청 — 상태를 pending 으로 전이 후 request_id 반환';

-- ============================================================
-- SECTION 10: keep_warm_send_notification() (messaging_sla_opt)
-- ============================================================
-- Edge Function cold-start 방지용 keep-warm ping.
-- 5분마다 cron 호출; 실제 메시지 발송 없음.

CREATE OR REPLACE FUNCTION public.keep_warm_send_notification()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ef_url TEXT;
  v_anon   TEXT;
BEGIN
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  v_anon := public.get_vault_secret('supabase_anon_key');

  IF v_ef_url IS NULL OR v_anon IS NULL THEN
    RAISE WARNING 'keep_warm_send_notification: vault secret 미설정, skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_ef_url || '/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body    := '{"keep_warm":true}'::JSONB
  );
END;
$$;

COMMENT ON FUNCTION public.keep_warm_send_notification() IS
  'T-20260525-foot-MESSAGING-V1: Edge Function cold-start 방지 keep-warm ping (5분 주기 cron)';

-- ============================================================
-- SECTION 11: notify_reminders_batch
-- ============================================================
-- FINAL state from hotfix v4 (20260524130000_messaging_auth_header_fix):
--   - vault fallback via get_vault_secret()
--   - Authorization: Bearer <anon_jwt>
--   - net.http_post (not pg_net.http_post)
--   - NOT EXISTS status = 'sent' only (not 'sent','pending')

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
        'event_type',     p_event_type,
        'reservation_id', v_reservation.reservation_id,
        'clinic_id',      v_reservation.clinic_id,
        'customer_id',    v_reservation.customer_id,
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
  'T-20260525-foot-MESSAGING-V1: 리마인더 배치 발송 — hotfix v4 final (Authorization Bearer + net.http_post)';

-- ============================================================
-- SECTION 12: notify_retry_failed
-- ============================================================
-- FINAL state from hotfix v4 (20260524130000_messaging_auth_header_fix):
--   - vault fallback via get_vault_secret()
--   - Authorization: Bearer <anon_jwt>
--   - net.http_post (not pg_net.http_post)
--   - status IN ('failed','pending'), 48h window, X-Retry-Log-Id header

CREATE OR REPLACE FUNCTION public.notify_retry_failed(
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_log         RECORD;
  v_retry_count INT := 0;
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_anon_jwt    TEXT;
BEGIN
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  ) || '/functions/v1/send-notification';

  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret')
  );

  v_anon_jwt := public.get_vault_secret('supabase_anon_key');

  FOR v_log IN
    SELECT nl.id AS log_id,
           nl.reservation_id,
           nl.clinic_id,
           nl.customer_id,
           nl.recipient_phone,
           nl.event_type
    FROM public.notification_logs nl
    WHERE nl.status IN ('failed', 'pending')
      AND nl.created_at > now() - INTERVAL '48 hours'
    LIMIT 50
  LOOP
    IF p_dry_run THEN v_retry_count := v_retry_count + 1; CONTINUE; END IF;

    UPDATE public.notification_logs
       SET status = 'pending'
     WHERE id = v_log.log_id;

    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'Authorization',   'Bearer ' || v_anon_jwt,
        'X-Internal-Cron', v_cron_secret,
        'X-Retry-Log-Id',  v_log.log_id::TEXT
      ),
      body    := jsonb_build_object(
        'event_type',      v_log.event_type,
        'reservation_id',  v_log.reservation_id,
        'clinic_id',       v_log.clinic_id,
        'customer_id',     v_log.customer_id,
        'recipient_phone', v_log.recipient_phone,
        'retry_log_id',    v_log.log_id
      )
    );
    v_retry_count := v_retry_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'retried', v_retry_count,
    'run_at',  to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.notify_retry_failed(BOOLEAN) IS
  'T-20260525-foot-MESSAGING-V1: 실패/대기 로그 재시도 (48h 윈도우, LIMIT 50) — hotfix v4 final';

-- ============================================================
-- SECTION 13: notify_reservation_messaging() RETURNS TRIGGER
-- ============================================================
-- FINAL state from messaging_sla_opt AC-2:
--   - SET search_path = 'public', 'vault'
--   - Pre-inserts pending log, passes retry_log_id to EF
--   - vault.decrypted_secrets 에서 직접 조회 (함수 호출 오버헤드 최소화)

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
  -- 트리거 조건: 신규 예약(INSERT status=reserved) 또는
  --             상태 전이(UPDATE old≠reserved → new=reserved)
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

  -- vault secret 조회 (decrypted_secrets 뷰는 SECURITY DEFINER 컨텍스트에서 접근 가능)
  SELECT decrypted_secret INTO v_ef_url  FROM vault.decrypted_secrets WHERE name = 'supabase_project_url'  LIMIT 1;
  SELECT decrypted_secret INTO v_secret  FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret'  LIMIT 1;
  SELECT decrypted_secret INTO v_anon    FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'     LIMIT 1;

  IF v_ef_url IS NULL OR v_secret IS NULL OR v_anon IS NULL THEN
    RAISE WARNING 'notify_reservation_messaging: vault secret 미설정 → skip';
    RETURN NEW;
  END IF;

  -- AC-2: pre-insert pending log → Edge Function 에 retry_log_id 전달
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
  'T-20260525-foot-MESSAGING-V1: 예약 확정 시 SMS 발송 트리거 함수 — SLA-OPT AC-2 final (pre-insert pending log)';

-- ============================================================
-- SECTION 14: reservations_messaging_trigger
-- ============================================================
-- 기존 트리거가 있으면 DROP 후 재생성 (idempotent).
-- AFTER INSERT OR UPDATE OF status 로 제한하여 불필요한 실행 방지.

DROP TRIGGER IF EXISTS reservations_messaging_trigger ON public.reservations;

CREATE TRIGGER reservations_messaging_trigger
  AFTER INSERT OR UPDATE OF status
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_reservation_messaging();

COMMENT ON TRIGGER reservations_messaging_trigger ON public.reservations IS
  'T-20260525-foot-MESSAGING-V1: 예약 상태 변경 → SMS 발송 트리거';

-- ============================================================
-- SECTION 15: pg_cron 작업 등록
-- ============================================================
-- 기존 동명 작업이 있으면 먼저 unschedule (idempotent 보장).
-- 이후 fresh 등록 → morning/retry 는 등록 후 active=FALSE 로 비활성화.

-- 15-A. 기존 작업 unschedule (있을 경우에만)
SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname IN (
   'foot-notif-reminder-d1',
   'foot-notif-reminder-morning',
   'foot-notif-retry-failed',
   'foot-ef-send-notification-keep-warm'
 );

-- 15-B. 신규 등록

-- D+1 리마인더: 매일 18:00 KST (= 09:00 UTC) — ACTIVE
SELECT cron.schedule(
  'foot-notif-reminder-d1',
  '0 9 * * *',
  $$SELECT public.notify_reminders_batch('resv_reminder_d1', FALSE)$$
);

-- 당일 오전 리마인더: 매일 09:00 KST (= 00:00 UTC) — 등록 후 비활성
SELECT cron.schedule(
  'foot-notif-reminder-morning',
  '0 0 * * *',
  $$SELECT public.notify_reminders_batch('resv_reminder_morning', FALSE)$$
);

-- 실패 재시도: 30분마다 — 등록 후 비활성
SELECT cron.schedule(
  'foot-notif-retry-failed',
  '*/30 * * * *',
  $$SELECT public.notify_retry_failed(FALSE)$$
);

-- Edge Function keep-warm: 5분마다 — ACTIVE
SELECT cron.schedule(
  'foot-ef-send-notification-keep-warm',
  '*/5 * * * *',
  $$SELECT public.keep_warm_send_notification()$$
);

-- 15-C. morning / retry 비활성화
UPDATE cron.job
   SET active = FALSE
 WHERE jobname IN (
   'foot-notif-reminder-morning',
   'foot-notif-retry-failed'
 );

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST
-- ============================================================
-- 배포 후 아래 항목을 순서대로 확인하세요.
--
-- [ ] 1. vault secret 등록 확인
--        SELECT name FROM vault.secrets
--        WHERE name IN ('supabase_project_url','supabase_anon_key','internal_cron_secret');
--        → 3개 모두 반환되어야 함.
--
-- [ ] 2. clinic_messaging_capability 테이블 생성 확인
--        SELECT COUNT(*) FROM public.clinic_messaging_capability;
--        → 에러 없이 0 반환 (시드 없음 — AC-4~7 승인 후 별도 시드)
--
-- [ ] 3. customers.sms_opt_in 컬럼 확인
--        SELECT column_name, data_type, column_default
--        FROM information_schema.columns
--        WHERE table_name = 'customers' AND column_name = 'sms_opt_in';
--        → boolean, TRUE 기본값
--
-- [ ] 4. pg_cron 등록 확인
--        SELECT jobname, schedule, active, command
--        FROM cron.job
--        WHERE jobname LIKE 'foot-%'
--        ORDER BY jobname;
--        → 4개 행 반환
--        → foot-notif-reminder-d1: active=TRUE
--        → foot-notif-reminder-morning: active=FALSE
--        → foot-notif-retry-failed: active=FALSE
--        → foot-ef-send-notification-keep-warm: active=TRUE
--
-- [ ] 5. 트리거 등록 확인
--        SELECT trigger_name, event_manipulation, action_timing
--        FROM information_schema.triggers
--        WHERE event_object_table = 'reservations'
--          AND trigger_name = 'reservations_messaging_trigger';
--        → 2개 행 (INSERT, UPDATE)
--
-- [ ] 6. dry-run 테스트
--        SELECT public.notify_reminders_batch('resv_reminder_d1', TRUE);
--        → {"dry_run": true, "dispatched": 0, "skipped_dry": <N>, ...} 반환
--
--        SELECT public.notify_retry_failed(TRUE);
--        → {"dry_run": true, "retried": <N>, ...} 반환
--
-- [ ] 7. get_vault_secret 화이트리스트 확인
--        SELECT public.get_vault_secret('solapi_api_key_test');  -- NULL or value
--        SELECT public.get_vault_secret('FORBIDDEN_KEY');        -- 반드시 NULL
--
-- [ ] 8. RLS 정책 확인 (서비스롤 외 일반 사용자로 테스트)
--        -- admin 계정: notification_templates CRUD 가능
--        -- staff 계정: notification_logs SELECT 가능, DML 불가
--
-- [ ] 9. admin_save_messaging_config 테스트 (staging 환경 권장)
--        SELECT public.admin_save_messaging_config(
--          '<clinic_uuid>'::UUID, 'test-api-key', 'test-secret', FALSE
--        );
--        → ok=true 반환, vault.secrets 에 2개 레코드 확인
--
-- [ ] 10. AC-4~7 승인 후 clinic_messaging_capability 시드 작업 별도 진행
--         (20260525030001_messaging_capability_seed.sql 예정)
-- ============================================================

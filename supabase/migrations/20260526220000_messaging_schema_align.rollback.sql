-- T-20260525-foot-MESSAGING-V1 스키마 정렬 롤백
-- 20260526220000_messaging_schema_align.sql 롤백
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-26

BEGIN;

-- notification_templates 원복
ALTER TABLE public.notification_templates
  RENAME COLUMN body TO template;

ALTER TABLE public.notification_templates
  RENAME COLUMN is_active TO active;

ALTER TABLE public.notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_channel_check;

ALTER TABLE public.notification_templates
  ADD CONSTRAINT notification_templates_channel_check
  CHECK (channel IN ('sms', 'kakao', 'push'));

-- notification_logs 원복
ALTER TABLE public.notification_logs
  RENAME COLUMN solapi_message_id TO provider_msg_id;

ALTER TABLE public.notification_logs
  DROP COLUMN IF EXISTS body_rendered;

ALTER TABLE public.notification_logs
  DROP COLUMN IF EXISTS error_code;

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'));

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_channel_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_channel_check
  CHECK (channel IN ('sms', 'kakao', 'push'));

COMMIT;

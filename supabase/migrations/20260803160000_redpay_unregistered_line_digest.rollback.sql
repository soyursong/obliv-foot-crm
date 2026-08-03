-- Rollback: T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST
--   cron unschedule + DROP FUNC 2 + DROP TABLE. 데이터손실 0(운영 알람 상태만 소실).
--   ★ webhook 롤백은 별도: REDPAY_UNREG_ALARM_MODE=realtime 로 즉시 구 cadence 복귀(코드 롤백 불요).

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-unreg-digest')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-unreg-digest');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.trigger_redpay_unreg_digest();
DROP FUNCTION IF EXISTS public.redpay_note_unregistered_line(text, text, text, uuid);
DROP TABLE IF EXISTS public.redpay_unregistered_line_seen;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260803160000';

COMMIT;

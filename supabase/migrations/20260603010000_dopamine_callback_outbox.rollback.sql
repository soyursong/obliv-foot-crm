-- ROLLBACK: 20260603010000_dopamine_callback_outbox.sql
-- T-20260602-multi-CALLBACK-EF-4-NEW (풋 outbox)
--
-- 주의: 데이터 보존을 위해 outbox 테이블은 아카이브하지 않고 DROP.
--       미발송분이 남아있을 수 있으니 롤백 전 잔여 pending/dlq 건 확인 권장:
--         SELECT status, count(*) FROM public.dopamine_callback_outbox GROUP BY 1;

BEGIN;

-- AC-S3 롤백: pg_cron 잡 해제
SELECT cron.unschedule('foot-dopamine-callback-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-dopamine-callback-worker');

-- AC-S2 롤백: 트리거 + 적재 함수 제거
DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin ON public.check_ins;
DROP TRIGGER IF EXISTS trg_dopamine_cb_resv    ON public.reservations;
DROP FUNCTION IF EXISTS public.enqueue_dopamine_callback();

-- worker / 알람 함수 제거
DROP FUNCTION IF EXISTS public.process_dopamine_callback_outbox();
DROP FUNCTION IF EXISTS public.alert_dopamine_callback_dlq();

-- AC-S1 롤백: 테이블 제거 (인덱스 동반 DROP)
DROP TABLE IF EXISTS public.dopamine_callback_outbox;
DROP TABLE IF EXISTS public.dopamine_callback_config;

COMMIT;

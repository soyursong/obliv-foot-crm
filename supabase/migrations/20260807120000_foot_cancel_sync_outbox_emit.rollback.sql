-- ROLLBACK — T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE
--   20260807120000_foot_cancel_sync_outbox_emit.sql 역적용(ADDITIVE 전량 제거).
--   기존 reservations 본체·dopamine_callback_outbox(lifecycle)·enqueue_dopamine_callback·
--   dopamine-callback-dispatch(→crm-lifecycle-callback) 무접촉 → 순소실 0.
--   순서: cron → trigger → fn → table (의존 역순).
-- 작성: dev-foot / 2026-08-07

BEGIN;

-- 5) cron 해제
SELECT cron.unschedule('foot-cancel-sync-drain')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-cancel-sync-drain');

-- 2) 트리거 해제 (fn drop 前)
DROP TRIGGER IF EXISTS trg_enqueue_cancel_sync_from_reservations ON public.reservations;

-- 2·3·4) 함수 제거
DROP FUNCTION IF EXISTS public.enqueue_cancel_sync_from_reservations();
DROP FUNCTION IF EXISTS public.cancel_sync_drain();
DROP FUNCTION IF EXISTS public.alert_cancel_sync_dlq();

-- 1) outbox 테이블 제거 (idx/RLS/UNIQUE 동반 삭제)
DROP TABLE IF EXISTS public.cancel_sync_outbox;

COMMIT;

-- POST-ROLLBACK CHECK
-- [ ] to_regclass('public.cancel_sync_outbox') IS NULL
-- [ ] cron.job 에 'foot-cancel-sync-drain' 부재
-- [ ] reservations 트리거에 trg_enqueue_cancel_sync_from_reservations 부재
-- [ ] dopamine_callback_outbox(lifecycle) + enqueue_dopamine_callback + dispatch/cron 은 무접촉(잔존)

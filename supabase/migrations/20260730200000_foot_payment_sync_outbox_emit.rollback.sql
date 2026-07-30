-- ROLLBACK — T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT
--   20260730200000_foot_payment_sync_outbox_emit.sql 역적용(ADDITIVE 전량 제거).
--   기존 payments 본체·dopamine_callback_outbox(visited/lifecycle) 무접촉 → 순소실 0.
--   순서: cron → trigger → fn → table (의존 역순).
-- 작성: dev-foot / 2026-07-30

BEGIN;

-- 5) cron 해제
SELECT cron.unschedule('foot-payment-sync-drain')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-payment-sync-drain');

-- 2) 트리거 해제 (fn drop 前)
DROP TRIGGER IF EXISTS trg_enqueue_payment_sync_from_payments ON public.payments;

-- 2·3·4) 함수 제거
DROP FUNCTION IF EXISTS public.enqueue_payment_sync_from_payments();
DROP FUNCTION IF EXISTS public.payment_sync_drain();
DROP FUNCTION IF EXISTS public.alert_payment_sync_dlq();

-- 1) outbox 테이블 제거 (idx/RLS/UNIQUE 동반 삭제)
DROP TABLE IF EXISTS public.payment_sync_outbox;

COMMIT;

-- POST-ROLLBACK CHECK
-- [ ] to_regclass('public.payment_sync_outbox') IS NULL
-- [ ] cron.job 에 'foot-payment-sync-drain' 부재
-- [ ] payments 트리거에 trg_enqueue_payment_sync_from_payments 부재
-- [ ] dopamine_callback_outbox(visited/lifecycle) + 그 트리거/워커/cron 은 무접촉(잔존)

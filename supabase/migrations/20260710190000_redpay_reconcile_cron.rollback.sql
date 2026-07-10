-- ROLLBACK: 20260710190000_redpay_reconcile_cron.sql
-- T-20260708-foot-REDPAY-CLOSING-TAB (activation_gate task#3)
--
-- cron job + trigger 함수만 제거. 기존 테이블(redpay_raw_transactions /
-- redpay_poller_state / payments / payment_reconciliation_log) 무접촉 → 데이터 손실 0.
-- (폴러가 이미 적재한 raw 행은 유지됨 — 잡만 멈춤.)

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-reconcile')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-reconcile');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.trigger_redpay_reconcile();

COMMIT;

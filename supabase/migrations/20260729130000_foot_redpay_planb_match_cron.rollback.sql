-- ROLLBACK: 20260729130000_foot_redpay_planb_match_cron.sql
-- T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어 · 만료/매칭 cron)
--
-- cron job + trigger 함수만 제거. 기존 테이블(pending_payment / redpay_raw_transactions /
-- payments) 무접촉 → 데이터 손실 0. (기존 선점행/raw 행은 유지 — 잡만 멈춤.)
-- 멱등: unschedule(존재 시) + DROP FUNCTION IF EXISTS → 재실행 무해.

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-planb-match')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-planb-match');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.trigger_redpay_planb_match();

COMMIT;

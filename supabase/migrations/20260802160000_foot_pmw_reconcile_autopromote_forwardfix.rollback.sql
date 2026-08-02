-- ROLLBACK: T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX
-- 승격기전(함수·cron)만 제거. 이미 승격된 check_ins(done)은 정상 완료행 → 되돌리지 않음
--   (되돌리면 stuck 재생성 = 원상복구가 아니라 회귀). 데이터 정정 필요 시 별도 backfill SOP 봉투.
-- DDL 0(신규 컬럼·테이블·enum 없음) → 함수 DROP + cron unschedule 만.

DO $$
BEGIN
  PERFORM cron.unschedule('foot-pmw-autopromote')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-pmw-autopromote');
END $$;

DROP FUNCTION IF EXISTS public.promote_reconciled_payment_waiting(uuid, uuid);
DROP FUNCTION IF EXISTS public.count_stuck_reconciled_payment_waiting(uuid);

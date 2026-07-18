-- ROLLBACK: T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN (역순 additive drop)
-- 전건 ADDITIVE 롤백. 순서: 트리거 비활성 → 워커 unschedule → 함수 drop → outbox/config drop → 컬럼 유지(무해).
-- ⚠daily_closings ADD 컬럼(revision 등)은 무해(nullable/default) → 유지. 데이터 파괴 0.

BEGIN;

-- 1) pg_cron unschedule (방어적)
DO $$
BEGIN
  PERFORM cron.unschedule('foot-closing-confirmed-worker')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-closing-confirmed-worker');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 미가용 — unschedule 생략. (%)', SQLERRM;
END $$;

-- 2) 트리거 제거
DROP TRIGGER IF EXISTS trg_enqueue_closing_confirmed      ON public.daily_closings;
DROP TRIGGER IF EXISTS trg_daily_closing_confirm_guard    ON public.daily_closings;
DROP TRIGGER IF EXISTS trg_closing_config_stamp_live_since ON public.closing_confirmed_config;

-- 3) 함수 제거
DROP FUNCTION IF EXISTS public.foot_closing_herald_preflight();
DROP FUNCTION IF EXISTS public.process_closing_confirmed_outbox();
DROP FUNCTION IF EXISTS public.alert_closing_confirmed_dlq();
DROP FUNCTION IF EXISTS public.enqueue_closing_confirmed();
DROP FUNCTION IF EXISTS public.closing_config_stamp_live_since();
DROP FUNCTION IF EXISTS public.closing_month_projection(UUID, DATE);
DROP FUNCTION IF EXISTS public.closing_insurance_split(UUID, DATE);
DROP FUNCTION IF EXISTS public.closing_source_split(UUID, DATE);
DROP FUNCTION IF EXISTS public.daily_closing_confirm_guard();
DROP FUNCTION IF EXISTS public.closing_payment_snapshot(UUID, DATE);

-- 4) 신규 테이블 제거(신규객체 → 파괴 아님)
DROP TABLE IF EXISTS public.closing_confirmed_outbox;
DROP TABLE IF EXISTS public.closing_confirmed_config;

-- 5) daily_closings ADD 컬럼: 유지(무해). 완전 원복 원할 때만 아래 주석 해제.
-- ALTER TABLE public.daily_closings
--   DROP COLUMN IF EXISTS payments_snapshot_hash,
--   DROP COLUMN IF EXISTS dirty,
--   DROP COLUMN IF EXISTS revision,
--   DROP COLUMN IF EXISTS unconfirmed_at,
--   DROP COLUMN IF EXISTS unconfirm_reason,
--   DROP COLUMN IF EXISTS unconfirmed_by,
--   DROP COLUMN IF EXISTS confirmed_by;

COMMIT;

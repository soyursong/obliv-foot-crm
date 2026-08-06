-- ROLLBACK — T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN
--   20260806210000_foot_consult_notify_outbox_decouple.sql 역적용(ADDITIVE 전량 제거).
--   기존 check_ins 본체·consult_notify_* 컬럼·dopamine_callback_outbox 무접촉 → 순소실 0.
--   순서: cron → fn → table → CHECK 원복 (의존 역순).
-- 작성: dev-foot / 2026-08-06

BEGIN;

-- 5) cron 해제
SELECT cron.unschedule('foot-consult-notify-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-consult-notify-worker');

-- 5·4·3) 함수 제거
DROP FUNCTION IF EXISTS public.process_consult_notify_outbox();
DROP FUNCTION IF EXISTS public.alert_consult_notify_dlq();
DROP FUNCTION IF EXISTS public.enqueue_consult_notify(UUID, UUID, TEXT, TEXT, UUID);

-- 1) outbox 테이블 제거 (idx/RLS/UNIQUE 동반 삭제)
DROP TABLE IF EXISTS public.consult_notify_outbox;

-- 2) CHECK 원복 — 'failed' 제거(원 2값 복원).
--    ⚠ 원복 전 'failed' 잔존 행이 있으면 제약 실패 → 원복 시 먼저 'sending'(재확정/재시도 가능)으로 정정 필요.
UPDATE public.check_ins SET consult_notify_status = 'sending'
  WHERE consult_notify_status = 'failed';
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS chk_check_ins_consult_notify_status;
ALTER TABLE public.check_ins
  ADD CONSTRAINT chk_check_ins_consult_notify_status
  CHECK (consult_notify_status IS NULL OR consult_notify_status IN ('sending','sent'));

COMMIT;

-- POST-ROLLBACK CHECK
-- [ ] to_regclass('public.consult_notify_outbox') IS NULL
-- [ ] cron.job 에 'foot-consult-notify-worker' 부재
-- [ ] enqueue_consult_notify / process_consult_notify_outbox / alert_consult_notify_dlq 함수 부재
-- [ ] chk_check_ins_consult_notify_status 가 2값('sending','sent')으로 원복
-- [ ] dopamine_callback_outbox + 그 트리거/워커/cron 은 무접촉(잔존)

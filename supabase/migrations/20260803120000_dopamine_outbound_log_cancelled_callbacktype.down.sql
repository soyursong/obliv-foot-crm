-- ROLLBACK — T-20260702-foot-CANCEL-SENDER-ENV-WIRING callback_type CHECK 확장 원복
-- 주의: 'cancelled' 행이 이미 존재하면 재-ADD 시 23514 로 실패함(정상 — 데이터 무결성 보호).
--   원복 필요 시 'cancelled' 행 처리(아카이브/삭제) 선행.
BEGIN;

ALTER TABLE public.dopamine_outbound_log
  DROP CONSTRAINT IF EXISTS dopamine_outbound_log_callback_type_check;

ALTER TABLE public.dopamine_outbound_log
  ADD CONSTRAINT dopamine_outbound_log_callback_type_check
  CHECK (callback_type IN ('visited', 'paid'));

COMMIT;

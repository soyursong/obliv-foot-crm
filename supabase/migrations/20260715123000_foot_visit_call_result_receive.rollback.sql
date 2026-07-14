-- ROLLBACK — T-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME Part A (receive)
-- ADDITIVE 역전. 저장값 소실은 도파민 재push로 무손실 복구 가능(canonical SoT=도파민 cue_cards.visit_call_result).
DROP INDEX IF EXISTS public.idx_reservations_visit_call_event_id;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_visit_call_result_check;
ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS visit_call_result,
  DROP COLUMN IF EXISTS visit_call_result_at,
  DROP COLUMN IF EXISTS visit_call_result_event_id;

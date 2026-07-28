-- ROLLBACK for T-20260728-foot-VISITTYPE-HEO-4717-RETURNING-FIX
-- Reverts single-row status→done promotion of check_in 6151b3b3 (현은호 #F-4717).
-- Run inside a single transaction if manual recovery needed.
BEGIN;
-- undo step3: status_transitions co-INSERT (fingerprinted by changed_by)
DELETE FROM public.status_transitions
 WHERE check_in_id='6151b3b3-38e6-4fac-93b8-7b18133e51df'
   AND changed_by='system:backfill:T-20260728-foot-VISITTYPE-HEO-4717'
   AND from_status='payment_waiting' AND to_status='done';
-- undo step1+step2: revert status→payment_waiting (trigger set_completed_at nulls completed_at on leaving done)
UPDATE public.check_ins SET status='payment_waiting'
 WHERE id='6151b3b3-38e6-4fac-93b8-7b18133e51df' AND status='done';
COMMIT;

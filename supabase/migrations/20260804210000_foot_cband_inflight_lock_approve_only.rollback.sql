-- ROLLBACK: 20260804210000_foot_cband_inflight_lock_approve_only.sql
-- T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY (증분-6 / AC-11)
-- 역: L2 in-flight 잠금을 mig 20260731190000 의 원형(tran_type 무관)으로 복원.
--   ⚠ 복원 후엔 취소(0430)도 다시 L2 에 참여 → 취소 후 재결제/동시취소 오차단(AC-11 회귀) 재발 가능.

BEGIN;

DROP INDEX IF EXISTS public.ux_cband_pa_inflight_checkin;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cband_pa_inflight_checkin
  ON public.cband_payment_attempts (clinic_id, check_in_id)
  WHERE status = 'requested' AND check_in_id IS NOT NULL;

COMMENT ON INDEX public.ux_cband_pa_inflight_checkin IS
  '체크인당 in-flight(requested) 1건 — 동시 이중요청 DB 백스톱(L3 앱뮤텍스 보완). T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD';

COMMIT;

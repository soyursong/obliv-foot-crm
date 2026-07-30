-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE
--   (20260730130000_foot_redpay_planb_manual_override.sql)
-- ══════════════════════════════════════════════════════════════════
-- ADDITIVE 순증분의 정확한 역연산: DROP COLUMN excluded_at + old CHECK 복원('manual_override' 제거 → 5값).
--   ⚠ status='manual_override' 로 전이된 선점행이 있으면 CHECK 복원(6→5값) 시 위반 → rollback 전 supervisor 가
--     SELECT count(*) FROM public.pending_payment WHERE status='manual_override' 확인. >0 이면 사전 정정
--     (예: manual_override → expired 로 되돌린 뒤 rollback). 정정 근거는 감사로그 보존.
--   무접촉: payments/redpay_raw_transactions/customers/check_ins/clinics 원본 미변경.
--           pending_payment 기존 컬럼·인덱스·트리거·RLS·부분유니크·expires_at/locked_until/fail_reason 미변경.
-- 멱등: DROP COLUMN IF EXISTS + DROP CONSTRAINT IF EXISTS → ADD (재실행 무해).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 신규 컬럼 제거.
ALTER TABLE public.pending_payment DROP COLUMN IF EXISTS excluded_at;

-- 2. old CHECK 복원 (widen 역연산: 'manual_override' 제거 → 5값).
ALTER TABLE public.pending_payment
  DROP CONSTRAINT IF EXISTS pending_payment_status_check;
ALTER TABLE public.pending_payment
  ADD CONSTRAINT pending_payment_status_check
  CHECK (status IN ('open','matched','expired','failed','cancelled'));

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD
--   (20260727100000_foot_redpay_planb_pending_payment_ttl.sql)
-- ══════════════════════════════════════════════════════════════════
-- ADDITIVE 순증분의 정확한 역연산: DROP COLUMN×3 + old CHECK 복원.
--   ⚠ status='failed' 로 전이된 선점행이 있으면 CHECK 복원(구 5→4값) 시 위반 → rollback 전 supervisor 가
--     SELECT count(*) FROM pending_payment WHERE status='failed' 확인. >0 이면 사전 정정 후 rollback.
--   무접촉: payments/redpay_raw_transactions/customers/check_ins/clinics 원본 미변경.
--           pending_payment 기존 컬럼·인덱스·트리거·RLS·부분유니크 미변경.
-- 멱등: DROP COLUMN IF EXISTS + DROP CONSTRAINT IF EXISTS → ADD (재실행 무해).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 신규 컬럼 3종 제거.
ALTER TABLE public.pending_payment DROP COLUMN IF EXISTS fail_reason;
ALTER TABLE public.pending_payment DROP COLUMN IF EXISTS locked_until;
ALTER TABLE public.pending_payment DROP COLUMN IF EXISTS expires_at;

-- 2. old CHECK 복원 (widen 역연산: 'failed' 제거 → 4값).
ALTER TABLE public.pending_payment
  DROP CONSTRAINT IF EXISTS pending_payment_status_check;
ALTER TABLE public.pending_payment
  ADD CONSTRAINT pending_payment_status_check
  CHECK (status IN ('open','matched','expired','cancelled'));

COMMIT;

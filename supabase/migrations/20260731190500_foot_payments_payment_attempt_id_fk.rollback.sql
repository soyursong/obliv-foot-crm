-- ROLLBACK: 20260731190500_foot_payments_payment_attempt_id_fk.sql (K7)
-- T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
-- ADDITIVE 역: 인덱스·FK·신규컬럼 제거. 기존 payments 행/컬럼 무접촉.

BEGIN;

DROP INDEX IF EXISTS public.ux_payments_payment_attempt_id;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_attempt_id_fkey;

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS payment_attempt_id,
  DROP COLUMN IF EXISTS merchant_no;

COMMIT;

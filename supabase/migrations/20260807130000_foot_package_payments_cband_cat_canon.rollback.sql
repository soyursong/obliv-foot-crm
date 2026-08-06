-- ROLLBACK: 20260807120000_foot_package_payments_cband_cat_canon.sql
-- T-20260806-foot-PLANA-PKG-PAY-EXPAND / DA-20260806-foot-PLANA-PKG-PAY-LANDING-MODEL(b)
-- ADDITIVE 역: net-new 인덱스·FK·payment_attempt_id 컬럼만 제거.
-- ★external_approval_no/external_tid 는 DROP 하지 않는다 — mig 20260523040000(PAY-INPUT-001) 소유의
--   선행 컬럼으로, 본 마이그의 ADD 는 IF NOT EXISTS no-op 였다(역=무접촉). 기존 package_payments 행 무접촉.

BEGIN;

DROP INDEX IF EXISTS public.ux_package_payments_payment_attempt_id;

ALTER TABLE public.package_payments
  DROP CONSTRAINT IF EXISTS package_payments_payment_attempt_id_fkey;

ALTER TABLE public.package_payments
  DROP COLUMN IF EXISTS payment_attempt_id;

COMMIT;

-- ROLLBACK: Step3 VALIDATE — T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
-- ============================================================================
-- VALIDATE 는 직접 un-validate 불가 → convalidated=true 를 false(NOT VALID)로 되돌리려면
-- DROP + 동일 verbatim 식으로 NOT VALID 재-ADD (parent Step1 20260713160000 정본식과 동일).
-- 데이터 무변경 (Step2 백필 데이터는 별도 rollback = apply_capture.json before-image 원복).
-- ============================================================================

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_phone_e164_chk;
ALTER TABLE public.customers ADD CONSTRAINT customers_phone_e164_chk
  CHECK (
    phone IS NULL
    OR phone LIKE 'DUMMY-%'
    OR phone = '+821000000000'
    OR phone ~ '^\+82(1[016789]\d{7,8})$'
    OR phone ~ '^\+(?!82)[1-9]\d{6,14}$'
  ) NOT VALID;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_customer_phone_e164_chk;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_customer_phone_e164_chk
  CHECK (
    customer_phone IS NULL
    OR customer_phone LIKE 'DUMMY-%'
    OR customer_phone = '+821000000000'
    OR customer_phone ~ '^\+82(1[016789]\d{7,8})$'
    OR customer_phone ~ '^\+(?!82)[1-9]\d{6,14}$'
  ) NOT VALID;

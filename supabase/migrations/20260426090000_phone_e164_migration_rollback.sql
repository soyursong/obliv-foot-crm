-- T-PHONE-E164 Phase C Rollback — foot CRM E.164 → 010 복구

BEGIN;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_phone_e164_chk;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_customer_phone_e164_chk;

UPDATE public.customers
SET phone = '0' || substring(phone from 4)
WHERE phone LIKE '+82%';

UPDATE public.reservations
SET customer_phone = '0' || substring(customer_phone from 4)
WHERE customer_phone LIKE '+82%';

COMMIT;

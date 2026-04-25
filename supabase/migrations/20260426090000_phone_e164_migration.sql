-- T-PHONE-E164 (MSG-20260426-0400) — Phase C foot CRM 백필
-- DB 저장 = E.164 (+8210XXXXXXXX). 적용 대상: customers.phone, reservations.customer_phone
-- idempotent: 이미 +82 시작이면 건너뜀.

BEGIN;

-- 사전: customers UNIQUE 충돌 검증 (clinic_id별 phone digit 중복)
-- 이 마이그레이션 자체는 충돌이 발생하면 ROLLBACK. 사전 점검 권장:
--   SELECT clinic_id, regexp_replace(phone, '[^0-9]', '', 'g') d, COUNT(*)
--   FROM public.customers GROUP BY clinic_id, d HAVING COUNT(*) > 1;

UPDATE public.customers
SET phone = '+82' || substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
WHERE phone IS NOT NULL
  AND phone NOT LIKE '+82%'
  AND regexp_replace(phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$';

UPDATE public.reservations
SET customer_phone = '+82' || substring(regexp_replace(customer_phone, '[^0-9]', '', 'g') from 2)
WHERE customer_phone IS NOT NULL
  AND customer_phone NOT LIKE '+82%'
  AND regexp_replace(customer_phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$';

-- CHECK 제약 (NOT VALID — 신규만 강제)
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_phone_e164_chk;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_phone_e164_chk
  CHECK (phone IS NULL OR phone ~ '^\+82(1[016789]\d{7,8})$' OR phone !~ '^\+?82?0?1[016789]')
  NOT VALID;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_customer_phone_e164_chk;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_customer_phone_e164_chk
  CHECK (customer_phone IS NULL OR customer_phone ~ '^\+82(1[016789]\d{7,8})$' OR customer_phone !~ '^\+?82?0?1[016789]')
  NOT VALID;

COMMIT;

-- 사후 검증:
-- SELECT count(*) FROM public.customers WHERE phone LIKE '010%';   -- 0 기대
-- SELECT count(*) FROM public.customers WHERE phone LIKE '+82%';   -- 백필 행수

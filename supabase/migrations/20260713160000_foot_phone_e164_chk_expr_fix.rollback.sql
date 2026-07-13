-- ROLLBACK: T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1
-- ============================================================================
-- 직전 권위 식 원복 = 20260426090000_phone_e164_migration.sql 의 CHECK 식(NOT VALID).
--   customers_phone_e164_chk / reservations_customer_phone_e164_chk 를
--   버그 있는 음성가드 식(`82?`)으로 되돌린다.
-- ⚠ 원복 시 enforcement 다시 무효화(로컬표기 010… 전량 프리패스) — 지혈 해제이므로
--    회귀/사고 대응 목적 한정. 데이터 무변경(NOT VALID) 이라 행 손실 없음.
-- 멱등: DROP CONSTRAINT IF EXISTS → 재실행 시 drop 후 재add 로 수렴.
-- ============================================================================

BEGIN;

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

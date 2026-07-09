-- ============================================================
-- ROLLBACK — T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC STAGE2 (a)+(b)+(c)
--   20260709120000_foot_customers_phone_dummy_add_trigger.sql 원복.
-- 순서(역): 트리거 → 트리거함수 → 판정함수 → 컬럼.
-- ⚠ legacy "000..." 4행 CORRECTIVE(별도 스텝)의 원복은
--    scripts/T-20260702-foot-FOREIGN-SELFREG-legacy-placeholder-phone-normalize.rollback.sql
--    (before-image 스냅샷 기준 복원) 를 별도 실행. 본 롤백은 스키마(a+b+c)만.
-- ============================================================

DROP TRIGGER IF EXISTS trg_customers_set_phone_dummy ON public.customers;
DROP FUNCTION IF EXISTS public.customers_set_phone_dummy();
DROP FUNCTION IF EXISTS public.is_dummy_phone(text);
ALTER TABLE public.customers DROP COLUMN IF EXISTS phone_dummy;

NOTIFY pgrst, 'reload schema';

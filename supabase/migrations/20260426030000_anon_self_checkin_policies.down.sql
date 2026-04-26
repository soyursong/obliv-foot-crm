-- 롤백
BEGIN;
DROP POLICY IF EXISTS anon_insert_customer_self_checkin ON public.customers;
DROP POLICY IF EXISTS anon_select_customer_self_checkin ON public.customers;
DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;
COMMIT;

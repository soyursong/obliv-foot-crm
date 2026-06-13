-- Rollback: T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN
DROP FUNCTION IF EXISTS public.fn_customer_birthdates(uuid, uuid[]);

-- Rollback: T-20260510-foot-ADDRESS-DETAIL-FIX
ALTER TABLE public.customers DROP COLUMN IF EXISTS address_detail;

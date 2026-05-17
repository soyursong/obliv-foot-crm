-- Rollback: customers.pending_healer_flag 제거
ALTER TABLE public.customers DROP COLUMN IF EXISTS pending_healer_flag;

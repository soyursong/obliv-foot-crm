-- T-20260516-foot-HEALER-RESV-BTN v2 rollback
ALTER TABLE public.customers DROP COLUMN IF EXISTS pending_healer_flag;

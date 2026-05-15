-- T-20260516-foot-HEALER-RESV-BTN rollback
ALTER TABLE public.reservations DROP COLUMN IF EXISTS healer_flag;

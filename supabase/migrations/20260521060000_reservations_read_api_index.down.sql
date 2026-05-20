-- Rollback: T-20260520-foot-RESERVATIONS-READ-API-EF AC-5
DROP INDEX IF EXISTS public.idx_reservations_clinic_date_desc;

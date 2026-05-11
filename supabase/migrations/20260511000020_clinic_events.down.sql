-- rollback: T-20260510-foot-CALENDAR-NOTICE
drop trigger if exists clinic_events_updated_at on public.clinic_events;
drop table if exists public.clinic_events;

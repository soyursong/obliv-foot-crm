-- rollback: T-20260510-foot-CALENDAR-NOTICE
drop trigger if exists notices_updated_at on public.notices;
drop table if exists public.notices;

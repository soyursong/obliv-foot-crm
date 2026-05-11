-- T-20260510-foot-CALENDAR-NOTICE: 원내 일정(캘린더) 테이블 생성
-- rollback: see 20260511000020_clinic_events.down.sql

create table if not exists public.clinic_events (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  title       text not null,
  description text,
  event_date  date not null,
  start_time  time,
  end_time    time,
  event_type  text not null default 'general'
              check (event_type in ('general', 'reservation', 'notice', 'holiday', 'meeting')),
  color       text,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS
alter table public.clinic_events enable row level security;

create policy "clinic_events_select" on public.clinic_events
  for select using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "clinic_events_insert" on public.clinic_events
  for insert with check (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "clinic_events_update" on public.clinic_events
  for update using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "clinic_events_delete" on public.clinic_events
  for delete using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

-- updated_at 트리거 (notices와 함수 공유)
create trigger clinic_events_updated_at
  before update on public.clinic_events
  for each row execute function public.set_updated_at();

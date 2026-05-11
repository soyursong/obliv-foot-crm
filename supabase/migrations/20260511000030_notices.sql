-- T-20260510-foot-CALENDAR-NOTICE: 공지사항 테이블 생성
-- rollback: see 20260511000010_notices.down.sql

create table if not exists public.notices (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  title       text not null,
  content     text,
  is_pinned   boolean not null default false,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS
alter table public.notices enable row level security;

-- authenticated 사용자: 같은 clinic 데이터만 접근
create policy "notices_select" on public.notices
  for select using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "notices_insert" on public.notices
  for insert with check (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "notices_update" on public.notices
  for update using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

create policy "notices_delete" on public.notices
  for delete using (
    clinic_id in (
      select clinic_id from public.staff where id = auth.uid()
    )
  );

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notices_updated_at
  before update on public.notices
  for each row execute function public.set_updated_at();

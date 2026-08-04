-- Dry-run(무영속 검증): T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
-- up.sql을 롤백되는 트랜잭션 안에서 실행 → 정책/테이블 생성이 오류 없이 통과하는지만 확인, prod 무영속.
-- 실행: psql "$DB_URL" -f 20260804110000_foot_monthly_sales_targets.dryrun.sql
begin;

-- up.sql 본문 (무영속 검증용 인라인)
create table if not exists public.monthly_sales_targets (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  year_month    text not null check (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  target_amount numeric not null default 0 check (target_amount >= 0),
  updated_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, year_month)
);
alter table public.monthly_sales_targets enable row level security;
drop policy if exists "monthly_sales_targets_select" on public.monthly_sales_targets;
create policy "monthly_sales_targets_select" on public.monthly_sales_targets
  for select using (clinic_id in (select clinic_id from public.staff where id = auth.uid()));
drop policy if exists "monthly_sales_targets_insert" on public.monthly_sales_targets;
create policy "monthly_sales_targets_insert" on public.monthly_sales_targets
  for insert with check (clinic_id in (select clinic_id from public.staff where id = auth.uid()));
drop policy if exists "monthly_sales_targets_update" on public.monthly_sales_targets;
create policy "monthly_sales_targets_update" on public.monthly_sales_targets
  for update using (clinic_id in (select clinic_id from public.staff where id = auth.uid()));
drop trigger if exists monthly_sales_targets_updated_at on public.monthly_sales_targets;
create trigger monthly_sales_targets_updated_at
  before update on public.monthly_sales_targets
  for each row execute function public.set_updated_at();

-- 무영속 검증: 삽입/충돌 upsert/체크제약이 동작하는지 확인 후 전체 롤백
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.monthly_sales_targets;
  raise notice 'monthly_sales_targets dry-run OK (rows=%)', v_cnt;
end $$;

rollback;

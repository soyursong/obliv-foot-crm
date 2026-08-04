-- T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
-- 통계 > "01 매출통계" 최상단 이번 달 목표 매출(월별 저장/수정) 보존소.
-- 성격: ADDITIVE (신규 테이블. DROP/타입변경/기존 매출·결제 테이블 접촉 없음. 회귀 0).
-- 멱등: create table/policy 모두 if not exists / drop-if-exists 가드.
-- rollback: 20260804110000_foot_monthly_sales_targets.rollback.sql
-- ★DA CONSULT MSG-20260804-100941-2sku GO 확정 후 적용 — deploy-ready는 그 전까지 보류(§S2.4).

create table if not exists public.monthly_sales_targets (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  year_month    text not null check (year_month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  target_amount numeric not null default 0 check (target_amount >= 0),
  updated_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, year_month)   -- upsert 키 (한 클리닉·한 달 = 1행)
);

-- RLS: clinic_events 동일 패턴(해당 클리닉 staff 멤버십). select/insert/update만(삭제 미노출).
alter table public.monthly_sales_targets enable row level security;

drop policy if exists "monthly_sales_targets_select" on public.monthly_sales_targets;
create policy "monthly_sales_targets_select" on public.monthly_sales_targets
  for select using (
    clinic_id in (select clinic_id from public.staff where id = auth.uid())
  );

drop policy if exists "monthly_sales_targets_insert" on public.monthly_sales_targets;
create policy "monthly_sales_targets_insert" on public.monthly_sales_targets
  for insert with check (
    clinic_id in (select clinic_id from public.staff where id = auth.uid())
  );

drop policy if exists "monthly_sales_targets_update" on public.monthly_sales_targets;
create policy "monthly_sales_targets_update" on public.monthly_sales_targets
  for update using (
    clinic_id in (select clinic_id from public.staff where id = auth.uid())
  );

-- updated_at 트리거 (기존 공용 함수 public.set_updated_at 재사용)
drop trigger if exists monthly_sales_targets_updated_at on public.monthly_sales_targets;
create trigger monthly_sales_targets_updated_at
  before update on public.monthly_sales_targets
  for each row execute function public.set_updated_at();

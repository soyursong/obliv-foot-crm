-- T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
-- 통계 > "01 매출통계" 최상단 이번 달 목표 매출(월별 저장/수정) 보존소.
-- 성격: ADDITIVE (신규 테이블. DROP/타입변경/기존 매출·결제 테이블 접촉 없음. 회귀 0).
-- 멱등: create table/policy 모두 if not exists / drop-if-exists 가드.
-- rollback: 20260804110000_foot_monthly_sales_targets.rollback.sql
--
-- ★ DA CONSULT-REPLY MSG-20260804-101213-0xck (DA-20260804-foot-MONTHLY-SALES-TARGETS-SCHEMA):
--   verdict=GO(조건부·ADDITIVE). §3.1 대표게이트 면제 CONFIRM(target=경영 계획치·비-PHI/원장/금전
--   → CEO 게이트 전건 미발동). supervisor DDL-diff(MIG-GATE) 단일. SSOT=da_decision_foot_monthly_sales_targets_schema_20260804.md.
--
-- ── VAT basis (DA forward-note ② — 배선 전 pin 필수) ──────────────────────────
--   target_amount 는 화면 '이번 달 목표 매출' 입력값이며, 달성률(%) 분모다.
--   분자(당월 실매출) = 기존 '누적매출(순)' SSOT(fetchRevenue = foot_stats_revenue RPC)
--     = package + single − refund (net) = CRM 실수납액 기준 = **VAT 포함(부가세 포함)**.
--   ∴ target_amount 도 동일 basis = **VAT 포함**으로 입력·저장한다(apples-to-apples).
--   (cf. A6 대시보드 대사축 vat_excl 과는 basis 상이 — 달성률 비교에는 CRM vat-incl 단일 basis 고정.)
--
-- ── RLS (DA Q2 판정 반영) ──────────────────────────────────────────────────
--   SELECT = 해당 clinic 승인 staff 전원 / INSERT·UPDATE = manager/admin(write-role) 한정.
--   목표매출 = 경영 계획 authority 수치(달성률 KPI 분모) → 전 staff write=임의변경 거버넌스 리스크 → REJECT.
--   canonical 술어(clinic_events write RLS 20260611190000 + G2 select 20260611160000) 재사용:
--     is_approved_user()/is_admin_or_manager() + clinic_id = current_user_clinic_id().
--   ⚠️ 비정규 소스(staff.id=auth.uid()) 금지 — staff.id 는 PK, auth.uid()와 매칭 안 됨(clinic_events RC 계승).

create table if not exists public.monthly_sales_targets (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  year_month    text not null check (year_month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  target_amount numeric not null default 0 check (target_amount >= 0),      -- VAT 포함(부가세 포함) basis
  updated_by    uuid references public.staff(id) on delete set null,        -- staff 엔티티 귀속축(actor-telemetry). auth.uid() 아님.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, year_month)   -- upsert 키 (한 클리닉·한 달 = 1행)
);

comment on table public.monthly_sales_targets is
  'T-20260804-foot-SALESSTAT-MONTHLY-TARGET: 월별 목표 매출(달성률 KPI 분모). clinic_id+year_month UNIQUE upsert. write=manager/admin 한정. DA MSG-20260804-101213-0xck GO.';
comment on column public.monthly_sales_targets.target_amount is
  '월 목표 매출(원). basis=CRM 누적매출(순)과 동일 = VAT 포함(부가세 포함). 달성률 분모.';
comment on column public.monthly_sales_targets.updated_by is
  '최종 수정 staff.id (FK staff, ON DELETE SET NULL). actor-telemetry — auth.uid() 아님.';

-- RLS: SELECT=승인 staff 전원 / INSERT·UPDATE=manager/admin. 삭제 미노출(정책 없음 = deny).
alter table public.monthly_sales_targets enable row level security;

-- SELECT: 해당 clinic 승인 staff 전원 (clinic_events G2 canonical 술어)
drop policy if exists "monthly_sales_targets_select" on public.monthly_sales_targets;
create policy "monthly_sales_targets_select" on public.monthly_sales_targets
  for select using (
    is_approved_user()
    and clinic_id = current_user_clinic_id()
  );

-- INSERT: manager/admin(write-role) 한정 + clinic 스코프 (DA Q2 REJECT 전 staff write)
drop policy if exists "monthly_sales_targets_insert" on public.monthly_sales_targets;
create policy "monthly_sales_targets_insert" on public.monthly_sales_targets
  for insert with check (
    is_admin_or_manager()
    and clinic_id = current_user_clinic_id()
  );

-- UPDATE: manager/admin 한정 + USING/WITH CHECK 양쪽 → 타 clinic 이전(escape) 차단
drop policy if exists "monthly_sales_targets_update" on public.monthly_sales_targets;
create policy "monthly_sales_targets_update" on public.monthly_sales_targets
  for update
  using (
    is_admin_or_manager()
    and clinic_id = current_user_clinic_id()
  )
  with check (
    is_admin_or_manager()
    and clinic_id = current_user_clinic_id()
  );

-- updated_at 트리거 (기존 공용 함수 public.set_updated_at 재사용)
drop trigger if exists monthly_sales_targets_updated_at on public.monthly_sales_targets;
create trigger monthly_sales_targets_updated_at
  before update on public.monthly_sales_targets
  for each row execute function public.set_updated_at();

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='monthly_sales_targets' ORDER BY cmd;
--   → SELECT: is_approved_user() AND clinic_id=current_user_clinic_id()
--     INSERT WITH CHECK / UPDATE USING+WITH CHECK: is_admin_or_manager() AND clinic_id=current_user_clinic_id()

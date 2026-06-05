-- T-20260605-foot-HANDOVER-BOARD: 파트별 인수인계 게시판(캘린더)
-- 신규 테이블 2종 — handover_notes(인수인계 1건) + handover_checklist_items(체크리스트 항목)
-- 요청: 김주연 총괄 (C0ATE5P6JTH, MSG-20260605-200544-97dv)
-- rollback: see 20260605130000_handover_notes.rollback.sql
--
-- 설계 메모:
--  - part_code: 상담실장(consultant_lead) / 코디(coordinator) / 치료사(therapist).
--    값은 애플리케이션 레이어(src/lib/handover.ts PART_OPTIONS)에서 enum 상수로 관리 →
--    추후 증감 가능. DB는 text 컬럼으로 두어 신규 코드 추가 시 마이그레이션 불필요.
--  - author_id: auth.uid()(=user_profiles.id)를 그대로 저장 → update/delete RLS가
--    author_id = auth.uid() 단순 비교로 동작(notices의 staff.id/auth.uid() 불일치 이슈 회피).
--  - author_name: 표시용 denormalize (staff/user_profiles 조인 실패 방어).

-- ── handover_notes ────────────────────────────────────────────────────────────
create table if not exists public.handover_notes (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  part_code   text not null,
  target_date date not null,
  author_id   uuid,                 -- auth.uid() (user_profiles.id). nullable: 매핑 실패 방어
  author_name text,                 -- 표시용 denorm
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_handover_notes_clinic_date
  on public.handover_notes (clinic_id, target_date);

-- ── handover_checklist_items ──────────────────────────────────────────────────
create table if not exists public.handover_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handover_notes(id) on delete cascade,
  label       text not null,
  is_checked  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_handover_checklist_handover
  on public.handover_checklist_items (handover_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.handover_notes enable row level security;
alter table public.handover_checklist_items enable row level security;

-- handover_notes:
--  SELECT/INSERT = 로그인 직원 전체 허용 (clinic 필터는 앱 레이어에서 수행, notices 패턴과 동일)
--  UPDATE/DELETE = 본인(author_id = auth.uid()) 한정
create policy "handover_notes_select" on public.handover_notes
  for select to authenticated using (true);

create policy "handover_notes_insert" on public.handover_notes
  for insert to authenticated with check (true);

create policy "handover_notes_update" on public.handover_notes
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "handover_notes_delete" on public.handover_notes
  for delete to authenticated
  using (author_id = auth.uid());

-- handover_checklist_items:
--  SELECT = 전 직원 / INSERT·UPDATE·DELETE = 부모 인수인계 작성자 본인 한정
create policy "handover_checklist_select" on public.handover_checklist_items
  for select to authenticated using (true);

create policy "handover_checklist_insert" on public.handover_checklist_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id and hn.author_id = auth.uid()
    )
  );

create policy "handover_checklist_update" on public.handover_checklist_items
  for update to authenticated
  using (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id and hn.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id and hn.author_id = auth.uid()
    )
  );

create policy "handover_checklist_delete" on public.handover_checklist_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.handover_notes hn
      where hn.id = handover_id and hn.author_id = auth.uid()
    )
  );

-- updated_at 자동 갱신 트리거 (set_updated_at 은 notices 마이그레이션에서 이미 정의됨)
create trigger handover_notes_updated_at
  before update on public.handover_notes
  for each row execute function public.set_updated_at();

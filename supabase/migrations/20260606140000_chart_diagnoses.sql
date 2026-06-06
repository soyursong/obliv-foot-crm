-- T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT (AC-0)
-- 진료차트 상병 다중등록 + 주/부 구분 — 신규 연결테이블 chart_diagnoses
-- 요청: 문지은 대표원장 (C0ATE5P6JTH, MSG-20260606-132723-5l1o)
-- rollback: see 20260606140000_chart_diagnoses.rollback.sql
-- backfill : see 20260606140000_chart_diagnoses.backfill.sql (사람 확인 후 별도 실행)
--
-- ⚠️ ADDITIVE ONLY — 기존 medical_charts.diagnosis 컬럼은 보존(drop 금지).
--    기존 단일값 read 하위호환 유지 + backfill로 chart_diagnoses primary 1건 매핑.
--
-- 설계 메모 (AC-0 모델 결정 = (a) 연결테이블):
--  - 선례: claim_diagnoses(claim_id, kcd_code, is_primary, sort_order) — 동일 코드베이스에
--    이미 "다중상병 + 주/부 + 정렬" 패턴이 검증됨. 본 테이블은 그 패턴을 chart 레벨로 미러.
--  - service_id: 상병 마스터(MGMT 정본, 현재 services.category_label='상병')와 FK 링크 →
--    코드(service_code)·명칭은 마스터 단일정본에서 파생. nullable(legacy backfill·미매칭 graceful).
--    ⚠️ MGMT AC-0 정본 미확정 → FK는 services로 두되, 마스터가 신규 테이블로 바뀌면
--       service_id 참조만 교체(snapshot 컬럼이 표시를 책임지므로 데이터 무손실).
--  - diagnosis_code / diagnosis_name: 등록 시점 스냅샷. 마스터 변경·삭제에도 출력 graceful +
--    MGMT 정본 결정과 디커플링(어느 결정이든 표시값은 스냅샷이 보장).
--  - diagnosis_type: primary(주상병) | secondary(부상병). 보험청구(claim_diagnoses.is_primary)와 직결.
--  - seq: 다중 등록 시 정렬(주상병 우선 + 입력 순). 출력 [D]에서 주상병 → 부상병 순 나열.

-- ── chart_diagnoses ───────────────────────────────────────────────────────────
create table if not exists public.chart_diagnoses (
  id              uuid primary key default gen_random_uuid(),
  chart_id        uuid not null references public.medical_charts(id) on delete cascade,
  service_id      uuid references public.services(id) on delete set null,  -- 마스터 링크(nullable: legacy/미매칭)
  diagnosis_type  text not null default 'primary'
                    check (diagnosis_type in ('primary','secondary')),     -- 주상병/부상병
  diagnosis_code  text,                 -- service_code 스냅샷 (예: M79.3). 코드 미상 시 null
  diagnosis_name  text not null,        -- 명칭 스냅샷 (예: 족저근막염)
  seq             integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_chart_diagnoses_chart
  on public.chart_diagnoses (chart_id);

create index if not exists idx_chart_diagnoses_service
  on public.chart_diagnoses (service_id);

-- ── RLS (medical_charts 접근정책과 동일 톤: 로그인 직원 전체 허용, clinic 필터는 앱 레이어) ──
alter table public.chart_diagnoses enable row level security;

create policy "chart_diagnoses_select" on public.chart_diagnoses
  for select to authenticated using (true);

create policy "chart_diagnoses_insert" on public.chart_diagnoses
  for insert to authenticated with check (true);

create policy "chart_diagnoses_update" on public.chart_diagnoses
  for update to authenticated using (true) with check (true);

create policy "chart_diagnoses_delete" on public.chart_diagnoses
  for delete to authenticated using (true);

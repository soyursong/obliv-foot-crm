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
--  - 선례(Q1 재대조 2026-08-09, da_consult_ref 정본): 실측 claim_diagnoses(20260515000010_sales_common_db.sql)
--    = disease_code(TEXT NOT NULL·free-text·master FK 없음) + disease_name(TEXT) + sort_order(INT)
--    + payment/package_payment/clinic_id. ⚠ **is_primary·kcd_code 컬럼은 부재**(티켓 ac0_resolution의
--    "claim_id+kcd_code+is_primary+sort_order" 인용은 misremembered — 실 스키마와 상이).
--    실 선례의 본질 = **snapshot free-text(disease_code/disease_name) + 정렬**·master 강제 없음.
--    ⟹ 본 테이블의 diagnosis_code/diagnosis_name = 선례 disease_code/disease_name와 동형(snapshot),
--       diagnosis_type enum + nullable service_id FK = 선례 대비 구조 SUPERSET(개선). primary(주/부) 개념은
--       선례에 없는 신규 rank 축 → parity 아님 → HARD-2(at-most-one-primary) DB 강제로 무결성 확보.
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

-- ── HARD-2 (da_consult_ref Q3-b): 주상병 at-most-one-primary per chart 강제 ─────────────
--   chart당 diagnosis_type='primary' 는 최대 1행. partial-unique 부재 시 주상병 다중 등록 가능 =
--   「주/부」 semantic 파손(AC-2 결속). DB-레벨 belt-and-suspenders(앱 validation과 이중 방어).
--   (부상병 secondary 는 다중 허용 → WHERE 절로 primary 만 유니크 제약.)
create unique index if not exists uq_chart_diagnoses_one_primary
  on public.chart_diagnoses (chart_id)
  where diagnosis_type = 'primary';

-- ── RLS (HARD-1 · da_consult_ref Q3 dispositive): 부모 medical_charts clinic 격리 상속 ──────
--   chart_diagnoses = medical_charts 의 ON DELETE CASCADE 자식·동일 diagnosis PHI class →
--   RLS 는 부모 이상으로 제한돼야 한다. 이전 permissive(USING(true)/WITH CHECK(true))는
--   타 clinic authenticated 사용자가 전 clinic 상병 PHI 를 열람 = cross-clinic PHI 누출 regression.
--   governance anchor = hardened 부모 mc_clinic_isolated_v3 (20260527_medchart_data_loss_fix),
--   ★permissive 옛 claim_diagnoses(20260515) 패턴 아님.
--   구현 = chart_id 로 medical_charts JOIN → 부모 clinic predicate 를 동형 술어로 직접 재현.
--   anon 무권한 유지(TO authenticated only → anon-EXEC surface 0 · A7 무증가).
alter table public.chart_diagnoses enable row level security;

-- idempotent: 재적용/permissive 잔재 제거 후 hardened 정책으로 대체
drop policy if exists "chart_diagnoses_select" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_insert" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_update" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_delete" on public.chart_diagnoses;

-- 부모 clinic 격리 술어(mc_clinic_isolated_v3 동형): 자식 행의 chart_id 가 사용자 clinic 소속 차트일 때만 노출.
create policy "chart_diagnoses_select" on public.chart_diagnoses
  for select to authenticated
  using (
    exists (
      select 1 from public.medical_charts mc
      where mc.id = chart_diagnoses.chart_id
        and (
          mc.clinic_id = current_user_clinic_id()::text
          or (
            current_user_clinic_id() is null
            and current_user_role() in ('admin','director','manager','coordinator')
          )
        )
    )
  );

create policy "chart_diagnoses_insert" on public.chart_diagnoses
  for insert to authenticated
  with check (
    exists (
      select 1 from public.medical_charts mc
      where mc.id = chart_diagnoses.chart_id
        and (
          mc.clinic_id = current_user_clinic_id()::text
          or (
            current_user_clinic_id() is null
            and current_user_role() in ('admin','director','manager','coordinator')
          )
        )
    )
  );

create policy "chart_diagnoses_update" on public.chart_diagnoses
  for update to authenticated
  using (
    exists (
      select 1 from public.medical_charts mc
      where mc.id = chart_diagnoses.chart_id
        and (
          mc.clinic_id = current_user_clinic_id()::text
          or (
            current_user_clinic_id() is null
            and current_user_role() in ('admin','director','manager','coordinator')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.medical_charts mc
      where mc.id = chart_diagnoses.chart_id
        and (
          mc.clinic_id = current_user_clinic_id()::text
          or (
            current_user_clinic_id() is null
            and current_user_role() in ('admin','director','manager','coordinator')
          )
        )
    )
  );

create policy "chart_diagnoses_delete" on public.chart_diagnoses
  for delete to authenticated
  using (
    exists (
      select 1 from public.medical_charts mc
      where mc.id = chart_diagnoses.chart_id
        and (
          mc.clinic_id = current_user_clinic_id()::text
          or (
            current_user_clinic_id() is null
            and current_user_role() in ('admin','director','manager','coordinator')
          )
        )
    )
  );

-- Backfill: T-20260606-foot-MEDCHART-RECORDER-NAME AC-2
-- ⚠️ 사람 확인(supervisor SQL 게이트 + 대표 검수) 후 별도 실행. 마이그레이션 자동 적용 금지.
-- ⚠️ 반드시 STEP 1(dry-run) 결과(전체수 / 매칭수 / 미매칭수 / 샘플10건)를 사람이 확인한 뒤 STEP 2 실행.
--
-- 매핑 규칙:
--   medical_charts.created_by(이메일)  ↔  user_profiles.email  →  user_profiles.name
--   매칭 실패(계정 삭제/이메일 불일치/이메일 NULL) → created_by_name = NULL 유지(추정 금지).
--   created_by_name 이 이미 채워진 행은 제외(idempotent — 신규 저장분 보존).
-- 주의: user_profiles.email 은 clinic 단위로 유니크하지 않을 수 있으므로 동일 이메일 다중 매칭 방어(MAX(name) 단일화).

-- ============================================================
-- STEP 1) DRY-RUN — 실제 변경 없음. 아래 4쿼리 결과를 1줄 요약 보고.
-- ============================================================
-- (1-a) backfill 대상 전체 건수 (created_by_name 비어있는 행)
select count(*) as backfill_target_total
from public.medical_charts mc
where mc.created_by_name is null
  and mc.created_by is not null
  and btrim(mc.created_by) <> '';

-- (1-b) 이름 매칭 성공 건수 (user_profiles.email 조인 성공)
select count(*) as match_success_count
from public.medical_charts mc
where mc.created_by_name is null
  and mc.created_by is not null
  and btrim(mc.created_by) <> ''
  and exists (
    select 1 from public.user_profiles up
    where up.email = mc.created_by and up.name is not null and btrim(up.name) <> ''
  );

-- (1-c) 매칭 실패 건수 (NULL 유지 대상)
select count(*) as match_fail_count
from public.medical_charts mc
where mc.created_by_name is null
  and mc.created_by is not null
  and btrim(mc.created_by) <> ''
  and not exists (
    select 1 from public.user_profiles up
    where up.email = mc.created_by and up.name is not null and btrim(up.name) <> ''
  );

-- (1-d) 매칭 샘플 10건 — 이메일→이름 육안 검수
select
  mc.id as chart_id,
  mc.created_by as email,
  (select max(up.name) from public.user_profiles up
     where up.email = mc.created_by and up.name is not null and btrim(up.name) <> '') as mapped_name
from public.medical_charts mc
where mc.created_by_name is null
  and mc.created_by is not null
  and btrim(mc.created_by) <> ''
order by mc.created_at desc
limit 10;

-- ============================================================
-- STEP 2) BACKFILL — STEP 1 사람 확인 후에만 주석 해제 실행.
--   idempotent: created_by_name 이미 채워진 행 제외 / 미매칭은 손대지 않음(NULL 유지).
-- ============================================================
-- update public.medical_charts mc
-- set created_by_name = sub.mapped_name
-- from (
--   select mc2.id,
--          (select max(up.name) from public.user_profiles up
--             where up.email = mc2.created_by and up.name is not null and btrim(up.name) <> '') as mapped_name
--   from public.medical_charts mc2
--   where mc2.created_by_name is null
--     and mc2.created_by is not null
--     and btrim(mc2.created_by) <> ''
-- ) sub
-- where mc.id = sub.id
--   and sub.mapped_name is not null;

-- ============================================================
-- STEP 3) 검증 — backfill 후 채워진 건수 = STEP1 (1-b) 매칭수 와 일치 확인
-- ============================================================
-- select count(*) as filled_after from public.medical_charts where created_by_name is not null;

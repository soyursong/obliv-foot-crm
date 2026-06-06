-- Backfill for chart_diagnoses (T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT AC-0)
-- ⚠️ 사람 확인(supervisor SQL 게이트 + 대표 검수) 후 별도 실행. 마이그레이션 자동 적용 금지.
-- ⚠️ 보험청구 직결 → 반드시 STEP 1(dry-run) 결과를 사람이 확인한 뒤 STEP 2 실행.
--
-- 매핑 규칙 (src/lib/autoBindContext.ts parseIcdFromText 미러):
--   "M79.3 족저근막염" → code='M79.3', name='족저근막염'
--   코드 추출 실패     → code=null,    name=원본 텍스트
--   기존 단일 diagnosis → diagnosis_type='primary', seq=0 (1차 backfill)
-- 정규식: ^[A-Z][0-9]{2,3}(\.[0-9])?\s+(.+)$

-- ============================================================
-- STEP 1) DRY-RUN — 영향 건수 + 파싱 샘플 확인 (실제 변경 없음)
-- ============================================================
-- (1-a) backfill 대상 건수
select count(*) as backfill_target_count
from public.medical_charts mc
where mc.diagnosis is not null
  and btrim(mc.diagnosis) <> ''
  and not exists (
    select 1 from public.chart_diagnoses cd where cd.chart_id = mc.id
  );

-- (1-b) 파싱 샘플 20건 — 코드/명칭 분리 결과 육안 검수
select
  mc.id as chart_id,
  mc.diagnosis as raw_diagnosis,
  substring(btrim(mc.diagnosis) from '^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+')             as parsed_code,
  coalesce(
    nullif(regexp_replace(btrim(mc.diagnosis), '^[A-Z][0-9]{2,3}(?:\.[0-9])?\s+', ''), ''),
    btrim(mc.diagnosis)
  ) as parsed_name
from public.medical_charts mc
where mc.diagnosis is not null
  and btrim(mc.diagnosis) <> ''
  and not exists (select 1 from public.chart_diagnoses cd where cd.chart_id = mc.id)
order by mc.created_at desc
limit 20;

-- (1-c) 코드 추출 실패(명칭만) 건수 — graceful(코드 null) 처리될 대상
select count(*) as no_code_count
from public.medical_charts mc
where mc.diagnosis is not null
  and btrim(mc.diagnosis) <> ''
  and substring(btrim(mc.diagnosis) from '^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+') is null
  and not exists (select 1 from public.chart_diagnoses cd where cd.chart_id = mc.id);

-- ============================================================
-- STEP 2) BACKFILL — STEP 1 사람 확인 후에만 실행
--   idempotent: 이미 chart_diagnoses 행이 있는 차트는 제외
-- ============================================================
-- insert into public.chart_diagnoses (chart_id, service_id, diagnosis_type, diagnosis_code, diagnosis_name, seq)
-- select
--   mc.id,
--   -- service_id: 스냅샷 코드로 상병 마스터 매칭 시도(없으면 null). MGMT 정본 확정 후 정합.
--   (select s.id from public.services s
--      where s.category_label = '상병'
--        and s.service_code = substring(btrim(mc.diagnosis) from '^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+')
--      limit 1),
--   'primary',
--   substring(btrim(mc.diagnosis) from '^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+'),
--   coalesce(
--     nullif(regexp_replace(btrim(mc.diagnosis), '^[A-Z][0-9]{2,3}(?:\.[0-9])?\s+', ''), ''),
--     btrim(mc.diagnosis)
--   ),
--   0
-- from public.medical_charts mc
-- where mc.diagnosis is not null
--   and btrim(mc.diagnosis) <> ''
--   and not exists (select 1 from public.chart_diagnoses cd where cd.chart_id = mc.id);

-- ============================================================
-- STEP 3) 검증 — backfill 후 건수 일치 확인
-- ============================================================
-- select count(*) as backfilled_rows from public.chart_diagnoses where diagnosis_type = 'primary' and seq = 0;

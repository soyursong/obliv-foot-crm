-- Rollback for 20260606140000_chart_diagnoses.sql
-- T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT (AC-0)
--
-- ⚠️ chart_diagnoses 를 drop 해도 medical_charts.diagnosis(원본 단일값)는 보존되어 있으므로
--    데이터 유실 없음(additive 마이그였음). 출력/입력은 기존 단일 diagnosis 경로로 복귀.

drop policy if exists "chart_diagnoses_select" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_insert" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_update" on public.chart_diagnoses;
drop policy if exists "chart_diagnoses_delete" on public.chart_diagnoses;

drop index if exists public.idx_chart_diagnoses_service;
drop index if exists public.idx_chart_diagnoses_chart;

drop table if exists public.chart_diagnoses;

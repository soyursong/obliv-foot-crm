-- T-20260609-foot-HIRA-INSURANCE-BATCH Phase2 — HIRA 약제급여목록 동기화 실행 로그
-- parent : T-20260609-foot-DRUG-INSURANCE-GATE (Phase1, prescription_codes 급여상태 컬럼)
-- rollback : 20260609160000_insurance_sync_runs.rollback.sql
--
-- 목적(AC4·AC5):
--   HIRA 약제급여목록(월간 .xlsx, ★Open API 아님 — STEP1 조사) 배치 동기화의 매 실행을 기록한다.
--   · 마지막 동기화 시각 / 결과(성공·실패·dry-run) / 매칭·갱신·스킵 통계 → 관리자 가시성(AC5)
--   · 실패 추적 + 안전동작 근거(AC4): 배치 실패 시 기존 insurance_status 무변경(=게이트 last-known 유지),
--     finished_at staleness 로 데이터 노후를 관리자가 인지.
--
-- ⚠️ ADDITIVE ONLY — 신규 테이블 1개. 기존 prescription_codes/게이트 경로 무변경·무손실.
--   prescription_codes.insurance_status 갱신은 배치 스크립트(scripts/hira_insurance_sync.mjs)가
--   source='hira' 로 수행. 본 테이블은 그 실행의 감사 로그.
--
-- 갱신 우선순위(AC3, 배치 스크립트가 강제):
--   insurance_status_source='manual' 이고 값이 있는 row 는 보존(수동 override 우선) → skipped_manual 집계.
--   source NULL/'hira' row 만 갱신(--force-overwrite-manual 시 manual 도 덮음, 로그에 기록).
--
-- supabase SQL 게이트 대상. dev DB(rxlomoozakkjesdqjtvd)는 dev-foot 직접 실행(직접실행 정책).
--   prod 적용은 supervisor 검토·실행.
--
-- dry-run 검증(적용 전 테이블 부재 확인):
--   SELECT to_regclass('public.insurance_sync_runs');  -- NULL 기대

CREATE TABLE IF NOT EXISTS public.insurance_sync_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 동기화 소스. Phase2 = 'hira' (심평원 약제급여목록 월간 xlsx).
  source          TEXT NOT NULL DEFAULT 'hira'
                    CHECK (source IN ('hira')),
  -- 다운로드한 원본 파일명(감사 추적). 정본 = 복지부 고시 별표1 .xlsx.
  source_file     TEXT,
  -- 고시 기준 기간(예 '2026-06'). 월간 갱신 — 어떤 고시본 기준인지.
  source_period   TEXT,
  -- dry_run = 변경 없이 리포트만 / apply = 실제 upsert.
  mode            TEXT NOT NULL
                    CHECK (mode IN ('dry_run','apply')),
  -- 실행 상태. running→success|failed|partial.
  status          TEXT NOT NULL
                    CHECK (status IN ('running','success','failed','partial')),
  total_rows      INT NOT NULL DEFAULT 0,   -- 파싱한 HIRA 약품 row 수
  matched         INT NOT NULL DEFAULT 0,   -- claim_code(EDI) 매칭 성공 수
  updated         INT NOT NULL DEFAULT 0,   -- 실제 insurance_status 갱신 수
  skipped_manual  INT NOT NULL DEFAULT 0,   -- manual override 보존으로 스킵(AC3)
  skipped_nochange INT NOT NULL DEFAULT 0,  -- 동일 상태라 변경 없음
  unmatched       INT NOT NULL DEFAULT 0,   -- prescription_codes 에 매칭 claim_code 없음
  error_message   TEXT,                     -- 실패 시 메시지(AC4)
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,              -- = 마지막 동기화 시각(AC5)
  run_by          TEXT                      -- 실행 주체(cli / 운영자 식별)
);

CREATE INDEX IF NOT EXISTS idx_insurance_sync_runs_started
  ON public.insurance_sync_runs (started_at DESC);

COMMENT ON TABLE public.insurance_sync_runs IS
  'T-20260609-foot-HIRA-INSURANCE-BATCH HIRA 약제급여목록 동기화 실행 로그. 마지막 동기화 시각·결과·통계(AC4/AC5).';
COMMENT ON COLUMN public.insurance_sync_runs.skipped_manual IS
  'manual override(insurance_status_source=manual) 보존으로 갱신 스킵한 수 (AC3 우선순위 규칙).';
COMMENT ON COLUMN public.insurance_sync_runs.finished_at IS
  '동기화 완료 시각 = 관리자 화면 "마지막 동기화" 표기 기준 (AC5).';

-- RLS: 관리자(admin/manager) 읽기. 쓰기는 배치 스크립트(service_role, RLS bypass)만.
ALTER TABLE public.insurance_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_sync_runs_read_admin" ON public.insurance_sync_runs;
CREATE POLICY "insurance_sync_runs_read_admin"
  ON public.insurance_sync_runs FOR SELECT
  USING (public.current_user_is_admin_or_manager());

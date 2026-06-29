-- T-20260629-foot-DUMMY-CHECKIN-RESV-LINK §1 (dev-foot)
-- medical_charts ↔ check_ins 결속용 nullable FK 컬럼 추가.
-- 목적: 진료차트(진료경과)를 "원장님이 직접 진료한 날의 방문(check_in)"에 결속.
--       치료사만 처치한 방문 = 미연결(NULL). 매 방문 자동결속 아님(정제된 A안, 김주연 총괄 2026-06-29 결정).
--
-- DA spec (gate1/2 CLEARED, DA-20260629-foot-CHART-CHECKIN-FK):
--   UUID NULL FK → check_ins(id) ON DELETE SET NULL
--   · PHI 보존 의무(의료법 §16-1): check_in 삭제돼도 진료기록 본체는 보존 → SET NULL.
--   · RESTRICT/CASCADE 금지. NOT NULL/backfill 금지. 레거시 NULL 허용.
--   · 컬럼명 check_in_id 고정 (checkin_id 금지 — check_in_services.check_in_id 명명 일치).
--
-- ★ ADDITIVE: 신규 NULL 허용 컬럼 + ON DELETE SET NULL FK → 기존행 전부 통과 무손실.
--   PG11+ instant add (DEFAULT 없음), write 0. 레거시 row 전부 check_in_id IS NULL.
--
-- 선검증 통과: check_ins.id PK = UUID (initial_schema.sql:128 `id UUID ... PRIMARY KEY`), 실데이터 1행 확인.
-- ⚠ medical_charts = PHI → supervisor DDL-diff PHI DB-GATE 거쳐 apply (supervisor 면제 아님).
-- 롤백: 20260629170000_medical_charts_check_in_id_fk.rollback.sql

ALTER TABLE public.medical_charts
  ADD COLUMN IF NOT EXISTS check_in_id UUID;

ALTER TABLE public.medical_charts
  DROP CONSTRAINT IF EXISTS medical_charts_check_in_id_fkey;

ALTER TABLE public.medical_charts
  ADD CONSTRAINT medical_charts_check_in_id_fkey
  FOREIGN KEY (check_in_id) REFERENCES public.check_ins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mc_check_in_id
  ON public.medical_charts (check_in_id)
  WHERE check_in_id IS NOT NULL;

COMMENT ON COLUMN public.medical_charts.check_in_id IS
  '진료차트가 결속된 방문(check_ins.id). 원장 직접 진료일 방문에만 결속. 치료사 처치 방문/레거시=NULL. ON DELETE SET NULL(PHI 보존, 의료법 §16-1). T-20260629-foot-DUMMY-CHECKIN-RESV-LINK';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'medical_charts' AND column_name = 'check_in_id'
  ) THEN
    RAISE EXCEPTION 'medical_charts.check_in_id 컬럼 생성 실패';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'medical_charts' AND constraint_name = 'medical_charts_check_in_id_fkey'
       AND constraint_type = 'FOREIGN KEY'
  ) THEN
    RAISE EXCEPTION 'medical_charts_check_in_id_fkey FK 생성 실패';
  END IF;
END $$;

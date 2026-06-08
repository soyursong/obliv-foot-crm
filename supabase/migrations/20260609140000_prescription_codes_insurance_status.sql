-- T-20260609-foot-DRUG-INSURANCE-GATE Phase1 — prescription_codes 급여여부(보험상태) 컬럼
-- planner MSG-20260609-030916-42nt (STEP1 그라운딩 후 db_change false→true 전환, Phase1 스펙 LOCK)
-- rollback : 20260609140000_prescription_codes_insurance_status.rollback.sql
--
-- 목적(DECISION 1-A / 2-B):
--   약품별 급여여부를 관리자가 수동 설정하고, 처방 게이트(checkRxInsuranceGate)가
--   차단상태(non_covered/deleted/criteria_changed) 약 처방 시 경고+차단(관리자 해제 가능).
--
-- ⚠️ ADDITIVE ONLY — prescription_codes 에 컬럼 3개 추가. 기존 데이터/경로 무변경·무손실.
--   · insurance_status            : 급여상태 enum (CHECK 강제). 기본 NULL.
--       └ NULL(미설정) = 게이트 통과(fail-open degrade) — Phase1 점진 적용 권장(planner LOCK).
--       └ 신규 상태값 추가 시 CHECK constraint 동시 갱신 의무(Lovable CHECK 동시갱신 정책 준수).
--   · insurance_status_updated_at : 상태 변경 시각(감사/추적).
--   · insurance_status_source     : 출처 enum. Phase1 = 전부 'manual'. Phase2(HIRA 배치)에서 'hira'.
--
-- supervisor SQL 게이트 대상. dev DB(rxlomoozakkjesdqjtvd)는 dev-foot 직접 실행(직접실행 정책).
--   prod 적용은 supervisor 검토·실행. FE는 deploy-tolerant(컬럼 미적용 시 게이트 자연 통과).
--
-- dry-run 검증(적용 전 컬럼 부재 확인):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='prescription_codes'
--     AND column_name IN ('insurance_status','insurance_status_updated_at','insurance_status_source');
--   -- 0 rows 기대

ALTER TABLE public.prescription_codes
  ADD COLUMN IF NOT EXISTS insurance_status TEXT
    CHECK (insurance_status IN ('covered','non_covered','deleted','criteria_changed')),
  ADD COLUMN IF NOT EXISTS insurance_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS insurance_status_source TEXT
    CHECK (insurance_status_source IN ('manual','hira'));

COMMENT ON COLUMN public.prescription_codes.insurance_status IS
  'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태: covered(급여)/non_covered(비급여)/deleted(급여삭제)/criteria_changed(급여기준변경). '
  'NULL=미설정(처방 게이트 통과=fail-open degrade). 차단상태=non_covered/deleted/criteria_changed.';
COMMENT ON COLUMN public.prescription_codes.insurance_status_updated_at IS
  'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태 마지막 변경 시각(감사/추적).';
COMMENT ON COLUMN public.prescription_codes.insurance_status_source IS
  'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태 출처: manual(관리자 수동) / hira(심평원 배치, Phase2). Phase1=전부 manual.';

-- 게이트 조회 가속(prescription_code_id IN (...) 후 insurance_status 판정) — 선택적·additive.
CREATE INDEX IF NOT EXISTS idx_prescription_codes_insurance_status
  ON public.prescription_codes (insurance_status)
  WHERE insurance_status IS NOT NULL;

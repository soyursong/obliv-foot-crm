-- T-20260803-foot-RXSET-VERIFY-CACHE-AC3 — prescription_codes 검증결과 영속 캐시 6컬럼 ADDITIVE
-- DA CONSULT-REPLY: DA-20260803-foot-RXSET-VERIFY-CACHE-AC3 (GO/ADDITIVE 조건부).
--   SSOT = da_decision_foot_rxset_verify_cache_ac3_20260803.md
-- rollback : 20260803210000_prescription_codes_verify_cache.rollback.sql
-- dry-run  : 20260803210000_prescription_codes_verify_cache.dryrun.sql
--
-- 목적(AC-3): 약품 외부DB(HIRA/MFDS) 검증 판정을 prescription_codes 행에 materialize.
--   판정 권위 = FE src/lib/drugVerification.ts (computeDrugVerifyVerdict/compareIngredient).
--   이 컬럼들은 그 결과의 **비-권위 성능 캐시**다 — 읽기는 항상 recompute 폴백(J2 방화벽).
--
-- ⚠️ ADDITIVE ONLY — prescription_codes 에 nullable 컬럼 6개 추가. 전부 NULL default·CHECK 無·
--   FK 無·기존 RLS 상속. 청구/KPI/집계 reader 무입력 → 순수 ADDITIVE.
--   autonomy §3.1 ADDITIVE + DA GO = 대표 게이트 면제, supervisor DDL-diff 만.
--   (동형 선례: 20260716140100_rxset_hira_provenance_columns, 20260615120000_rxset_tag_meta.)
--
-- 컬럼(DA J4 정확 스펙 — prefix verify_ 그룹핑):
--   verify_status        TEXT NULL        : HIRA 코드축 판정 캐시(verified/partial/unverified/pending).
--                                            CHECK 無 = 값 진화 시 비-ADDITIVE 회피 → app-enforced
--                                            (DrugVerifyStatus enum, FE describeVerifyStatus 안전 폴백).
--   verify_ingredient    TEXT NULL        : MFDS 성분 2차축 판정 캐시(matched/mismatch/unverified). app-enforced.
--   verify_matched_code  TEXT NULL        : 매칭된 HIRA claim_code 스냅샷. FK 아님.
--                                            placeholder(LEGACY-/HIRA-STD-/HIRA-) 제외 = 실 외부코드만.
--   verified_at          TIMESTAMPTZ NULL : 검증 수행 시각(naive 금지 = timestamptz).
--   verify_input_hash    TEXT NULL        : staleness self-healing 지문 — 입력3필드(claim_code/
--                                            code_source/insurance_status_source)의 FNV-1a 지문.
--                                            읽기 시 재산출 지문과 불일치 → 캐시 MISS → recompute(J3).
--   verify_model_version TEXT NULL        : 판정 로직 버전(FE VERIFY_MODEL_VERSION). 불일치 → MISS(J3).
--
-- J3 staleness 가드(DISPOSITIVE): 입력 정정 시 verify_input_hash 자동 불일치 → 읽기 recompute.
--   트리거 불요(FE 읽기부 self-healing, drugVerification.ts resolveVerifyVerdict/isVerifyCacheFresh).
-- backfill = N/A : 기존행 전부 NULL = 캐시 MISS = 첫 read recompute+populate 자연 warm-up.
--
-- 멱등: ADD COLUMN IF NOT EXISTS → 재실행 no-op. 무중단·무손실·완전 가역(rollback=DROP COLUMN).
-- supervisor DDL-diff 게이트. dev DB(rxlomoozakkjesdqjtvd)=dev-foot 직접 실행. prod=supervisor.
-- FE는 deploy-tolerant: 컬럼 미적용 시 resolveVerifyVerdict 가 자연히 recompute 폴백(캐시 MISS).

BEGIN;

ALTER TABLE public.prescription_codes
  ADD COLUMN IF NOT EXISTS verify_status        text,
  ADD COLUMN IF NOT EXISTS verify_ingredient    text,
  ADD COLUMN IF NOT EXISTS verify_matched_code  text,
  ADD COLUMN IF NOT EXISTS verified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS verify_input_hash    text,
  ADD COLUMN IF NOT EXISTS verify_model_version text;

COMMENT ON COLUMN public.prescription_codes.verify_status IS
  'AC-3 검증 캐시(비-권위): HIRA 코드축 판정 verified/partial/unverified/pending. 권위=FE drugVerification.ts. CHECK無=app-enforced. T-20260803-foot-RXSET-VERIFY-CACHE-AC3';
COMMENT ON COLUMN public.prescription_codes.verify_ingredient IS
  'AC-3 검증 캐시(비-권위): MFDS 성분 2차축 matched/mismatch/unverified. app-enforced. T-20260803-foot-RXSET-VERIFY-CACHE-AC3';
COMMENT ON COLUMN public.prescription_codes.verify_matched_code IS
  'AC-3 검증 캐시: 매칭된 HIRA claim_code 스냅샷(FK아님·placeholder LEGACY-/HIRA-STD-/HIRA- 제외). T-20260803-foot-RXSET-VERIFY-CACHE-AC3';
COMMENT ON COLUMN public.prescription_codes.verified_at IS
  'AC-3 검증 캐시: 검증 수행 시각(timestamptz). T-20260803-foot-RXSET-VERIFY-CACHE-AC3';
COMMENT ON COLUMN public.prescription_codes.verify_input_hash IS
  'AC-3 staleness self-healing 지문(FNV-1a): 입력3필드(claim_code/code_source/insurance_status_source). 읽기 재산출 지문 불일치→캐시 MISS→recompute(J3). T-20260803-foot-RXSET-VERIFY-CACHE-AC3';
COMMENT ON COLUMN public.prescription_codes.verify_model_version IS
  'AC-3 판정 로직 버전(FE VERIFY_MODEL_VERSION). 불일치→캐시 MISS(FE 로직 개정 자동무효화, J3). T-20260803-foot-RXSET-VERIFY-CACHE-AC3';

-- 검증: 6컬럼 존재 + 타입(verified_at = timestamptz, 나머지 = text) 확인
DO $$
DECLARE
  cnt int;
  ts_type text;
BEGIN
  SELECT count(*) INTO cnt
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_codes'
    AND column_name IN ('verify_status','verify_ingredient','verify_matched_code',
                        'verified_at','verify_input_hash','verify_model_version');
  IF cnt <> 6 THEN
    RAISE EXCEPTION 'VERIFY-CACHE verify FAILED: expected 6 columns, found %', cnt;
  END IF;

  SELECT data_type INTO ts_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_codes' AND column_name='verified_at';
  IF ts_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'VERIFY-CACHE verify FAILED: verified_at must be timestamptz, got %', ts_type;
  END IF;

  RAISE NOTICE 'VERIFY-CACHE OK: 6 verify_* cache columns present on prescription_codes (verified_at=timestamptz)';
END $$;

COMMIT;

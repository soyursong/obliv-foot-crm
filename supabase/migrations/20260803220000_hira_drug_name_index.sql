-- T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 — HIRA 명칭 인덱스 신규 전용 참조테이블 (ADDITIVE)
-- DA CONSULT-REPLY: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (GO / Option A / ADDITIVE).
--   SSOT = da_decision_foot_rxset_hira_name_index_ac8_20260803.md
-- rollback : 20260803220000_hira_drug_name_index.rollback.sql
-- dry-run  : 20260803220000_hira_drug_name_index.dryrun.sql
-- import   : scripts/import_hira_drug_name_index.mjs (멱등 ON CONFLICT DO NOTHING + rows-affected assert)
--
-- 목적(AC-8): 심평원(HIRA) 고시 약품 명칭 유니버스(외부 참조 코퍼스)를 별도 마스터 테이블에 1회 적재.
--   이 코퍼스가 있어야 카탈로그(prescription_codes ~499) 밖의 약을 "상품명으로 대조"(partial 판정)할
--   수단이 생긴다. 현재 partial 은 코퍼스 부재로 도달불가(drugVerification.ts §165 주석).
--
-- ★grain firewall (DA §1, dispositive):
--   prescription_codes = 병원 로컬 처방 카탈로그(billing 권위·claim_code UNIQUE·스태프 큐레이션 ~499).
--   hira_drug_name_index = 외부 참조 유니버스(심평원 명칭 코퍼스·read-only·상류 주기 refresh·병원 비종속).
--   → 마스터는 마스터 테이블에. 카탈로그에 덤프 시 claim_code UNIQUE/code_source CHECK 오염(REJECT).
--
-- ★VG-2 코드축 정렬(DA §6): item_std_code = 품목기준코드9(자연 unique 키) = prescription_codes.claim_code
--   'HIRA-{code}' 접두를 벗긴 raw 9자리 · hira_match_basis 'std9:{code}' 토큰 · AC-3 verify_matched_code 와
--   동일 품목기준코드9 namespace. cross-ref 규칙: prescription_codes.claim_code = 'HIRA-' || item_std_code.
--   ★EDI 청구코드축 혼용 금지(매칭 붕괴).
-- ★VG-3 FK 무(DA §6): prescription_codes → index FK 신설 금지 = reference-lookup 결합만.
--   기존 hira_mapped_to_code_id "no FK" 최소스펙 계승 → DROP-rollback orphan 무·grain 커플링 회피.
-- ★VG-4 코퍼스만 적재(DA §6): 이 티켓은 코퍼스 적재만. partial 활성화(forward read-path)·verdict
--   backfill 안 함(=AC-3 소관). computeDrugVerifyVerdict 무변경 → double-governance 없음.
--
-- change-class = ADDITIVE only(신규 테이블+인덱스, greenfield, 파괴 0) → §3.1 대표게이트 면제(DA §5).
--   게이트 = supervisor MIG-GATE(DDL-diff + Dry-Run No-Persistence + Ledger Reconciliation +
--   멱등/rows-affected assert). CEO 불요 · comp-gate N/A · backfill SOP N/A(greenfield).
-- PHI/거버넌스(DA §5): 공개 참조데이터 = 비-PHI·비-금전·비-원장(v2.30 drug_reference 동형).
--   RLS = authenticated SELECT-only(staff-facing lookup) · anon 신규 surface 0.
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS + EXTENSION IF NOT EXISTS → 재실행 no-op.
-- dev DB(rxlomoozakkjesdqjtvd)=dev-foot 직접 실행 가능. prod=supervisor MIG-GATE.

BEGIN;

-- 정규화명 trigram 매칭 인덱스용 확장(멱등·공유 안전).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.hira_drug_name_index (
  item_std_code    text        PRIMARY KEY,          -- 품목기준코드9(자연 unique 키). VG-2 코드축.
  name_ko          text        NOT NULL,             -- 심평원 고시 공식 제품명.
  name_normalized  text        NOT NULL,             -- 정규화명(매칭축). 권위=JS normalizeHiraDrugName(write/read 동형).
  ingredient_code  text        NULL,                 -- 성분코드(선택, source A 제공 시).
  ingredient_name  text        NULL,                 -- 성분명(선택, ingredient enrich).
  source_ref       text        NOT NULL,             -- source A provenance(예: 'data.go.kr:15067462').
  loaded_at        timestamptz NOT NULL DEFAULT now()-- 적재 시각(timestamptz).
);

COMMENT ON TABLE public.hira_drug_name_index IS
  'HIRA 명칭 인덱스(외부 참조 유니버스). 심평원 고시 약품 명칭 코퍼스 read-only 마스터. grain=참조 유니버스(≠prescription_codes 병원 카탈로그). 상류 주기 refresh·병원 비종속·FK 무. T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8';
COMMENT ON COLUMN public.hira_drug_name_index.item_std_code IS
  '품목기준코드9(자연 unique 키). cross-ref: prescription_codes.claim_code = ''HIRA-''||item_std_code · hira_match_basis ''std9:''||item_std_code · AC-3 verify_matched_code 동일 namespace. EDI 코드축 혼용 금지(VG-2).';
COMMENT ON COLUMN public.hira_drug_name_index.name_normalized IS
  '정규화명(매칭축). 권위=FE/스크립트 공용 normalizeHiraDrugName(src/lib/hiraDrugNameIndex.ts): trim+연속공백1칸+소문자fold, 용량표기 보존(auto-merge 금지 canon). GIN trigram 인덱스 대상.';
COMMENT ON COLUMN public.hira_drug_name_index.source_ref IS
  'source A provenance(data.go.kr 15067462 = AC-1 canonical 외부소스). 단일 canonical 소스 파생(코드 일관성 불변식).';

-- 정규화명 위 GIN trigram(pg_trgm) = 명칭 매칭축(DA §2). 카탈로그 밖 약을 상품명으로 대조하는 수단.
CREATE INDEX IF NOT EXISTS hira_drug_name_index_name_norm_trgm
  ON public.hira_drug_name_index USING gin (name_normalized gin_trgm_ops);

-- 성분명 보조 검색용(선택축, nullable). partial 판정은 상품명축이 1차 — 성분은 2차 보조.
CREATE INDEX IF NOT EXISTS hira_drug_name_index_ingredient_code
  ON public.hira_drug_name_index (ingredient_code) WHERE ingredient_code IS NOT NULL;

-- RLS: authenticated SELECT-only(staff-facing lookup). anon 신규 surface 0. write=service_role(import)만.
ALTER TABLE public.hira_drug_name_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hira_drug_name_index_select_authenticated ON public.hira_drug_name_index;
CREATE POLICY hira_drug_name_index_select_authenticated
  ON public.hira_drug_name_index
  FOR SELECT
  TO authenticated
  USING (true);

-- 검증: 테이블/PK/trigram 인덱스/RLS/pg_trgm 실재 확인(무통과 시 EXCEPTION).
DO $$
DECLARE
  has_table   bool;
  has_trgm    bool;
  has_idx     bool;
  rls_on      bool;
  has_ext     bool;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='hira_drug_name_index') INTO has_table;
  IF NOT has_table THEN RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED: table 부재'; END IF;

  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') INTO has_ext;
  IF NOT has_ext THEN RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED: pg_trgm 확장 부재'; END IF;

  SELECT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname='public' AND tablename='hira_drug_name_index'
                   AND indexname='hira_drug_name_index_name_norm_trgm') INTO has_idx;
  IF NOT has_idx THEN RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED: name_normalized trigram 인덱스 부재'; END IF;

  SELECT relrowsecurity FROM pg_class WHERE oid='public.hira_drug_name_index'::regclass INTO rls_on;
  IF NOT rls_on THEN RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED: RLS 미활성'; END IF;

  RAISE NOTICE 'HIRA-NAME-INDEX OK: 테이블+PK+trigram 인덱스+RLS(authenticated SELECT)+pg_trgm 모두 실재(코퍼스 적재는 import 스크립트).';
END $$;

COMMIT;

-- T-20260625-foot-PASSPORT-FOREIGN-INFO-PORT — 외국인 정보 그룹(국적/만료일) 컬럼 추가
-- 부모 에픽: T-20260625-foot-FOREIGN-PATIENT-SELFCHECKIN-REVIEW Phase 4
-- origin: obliv-derm-crm 20260609_NEWCUST-FOREIGN-INFO_up.sql (derm은 nationality_id FK 마스터,
--   foot는 nationalities 마스터 미보유 → nationality_code TEXT(ISO alpha-3)로 적응 이식)
-- Created: 2026-06-25
-- Rollback: 20260625120000_foreign_info_port_nationality_docexpiry.rollback.sql
--
-- ⚠ APPLY GATE: data-architect CONSULT GO + supervisor DDL-diff 통과 전 적용 금지.
--   (derm ungated 배포 사고 재발 방지 — 작성만, apply는 게이트 후.)
--
-- risk_verdict: 미정(CONSULT 대기). additive·비파괴·nullable·백필 없음.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- passport_number(TEXT), is_foreign(BOOLEAN)는 이미 존재 → 본 마이그는 신규 2컬럼만.

BEGIN;

-- 국적 ISO alpha-3 코드(예: KOR). 여권 MRZ 발급국/국적 자동채움 대상. nullable.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS nationality_code TEXT NULL;

COMMENT ON COLUMN public.customers.nationality_code IS
  '국적 ISO 3166-1 alpha-3 코드(예: KOR, USA). 여권 MRZ 자동채움·수동수정. nullable. PASSPORT-FOREIGN-INFO-PORT.';

-- 외국인 신분서류(여권/체류허가) 만료일. nullable — 한국인·미입력 시 NULL.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS foreign_doc_expiry DATE NULL;

COMMENT ON COLUMN public.customers.foreign_doc_expiry IS
  '외국인 신분서류(여권/체류허가) 만료일. nullable. PASSPORT-FOREIGN-INFO-PORT.';

COMMIT;

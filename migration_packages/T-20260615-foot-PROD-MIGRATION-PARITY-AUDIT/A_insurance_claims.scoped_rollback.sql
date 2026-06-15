-- ============================================================
-- AC-2 SCOPED ROLLBACK — #A insurance_claims_schema
-- T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT
-- ============================================================
-- ★ 옵션 A 개명(2026-06-15, DA-20260615-foot-INSURANCE-CLAIM-NAMING) 이후:
--   건보 child 가 고유명 insurance_claim_diagnoses 를 가지므로 본 배치 생성물 4 테이블 전부
--   안전하게 DROP 가능. live claim_diagnoses(결제연계, disease_code)는 이름이 다르므로
--   본 rollback 이 절대 건드리지 않는다 (네임스페이스 분리로 자동 보호).
--
-- 본 scoped rollback 이 제거하는 = 이 배치가 실제로 "생성"한 4 테이블:
--   edi_submissions, insurance_claim_diagnoses, claim_items, insurance_claims
--   ⚠ live claim_diagnoses (disease_code) 는 대상 아님 — 이름 미일치로 미접촉.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS edi_submissions CASCADE;
DROP TABLE IF EXISTS insurance_claim_diagnoses CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS insurance_claims CASCADE;

-- ⚠ live claim_diagnoses (결제연계, disease_code) 는 의도적으로 DROP 하지 않는다 (이름 분리로 보호).
DROP FUNCTION IF EXISTS update_insurance_claims_updated_at() CASCADE;

COMMIT;

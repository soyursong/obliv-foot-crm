-- Rollback: T-20260520-ins-SCHEMA-COMMON (풋센터)
-- T-20260520-foot-INS-UI AC-2 down
-- 순서 중요: 의존하는 테이블부터 DROP

DROP TABLE IF EXISTS edi_submissions CASCADE;
DROP TABLE IF EXISTS claim_diagnoses CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS insurance_claims CASCADE;

DROP FUNCTION IF EXISTS update_insurance_claims_updated_at() CASCADE;

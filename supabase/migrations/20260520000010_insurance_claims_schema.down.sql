-- Rollback: T-20260520-ins-SCHEMA-COMMON (풋센터)
-- T-20260520-foot-INS-UI AC-2 down
-- 순서 중요: 의존하는 테이블부터 DROP
--
-- ★ scoped_rollback (T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT AC-3 #A):
--   본 마이그가 "신규 생성"한 4 테이블만 DROP. 옵션 A 개명으로 건보 child 가
--   insurance_claim_diagnoses 라는 고유명을 가지므로 apply/rollback 모두 live 와 충돌 0.
--   ⚠ prod live claim_diagnoses (결제연계 PHI, disease_code) 는 본 마이그 생성물이 아니므로
--      여기서 절대 DROP 하지 않는다 (네임스페이스 분리로 자동 보호).

DROP TABLE IF EXISTS edi_submissions CASCADE;
DROP TABLE IF EXISTS insurance_claim_diagnoses CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS insurance_claims CASCADE;

DROP FUNCTION IF EXISTS update_insurance_claims_updated_at() CASCADE;

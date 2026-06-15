-- ============================================================
-- AC-2 SCOPED ROLLBACK — #A insurance_claims_schema
-- T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT
-- ============================================================
-- ★★ 원본 20260520000010_insurance_claims_schema.down.sql 사용 금지 ★★
--   원본 down.sql 은 claim_diagnoses 를 DROP CASCADE 한다.
--   그러나 claim_diagnoses 는 prod 에 別마이그(20260515000010)로 선존재 →
--   원본 down 을 쓰면 본 배치가 만들지 않은 기존 테이블/데이터를 파괴한다.
--
-- 본 scoped rollback 은 이 배치가 실제로 "생성"한 3 테이블만 제거한다:
--   edi_submissions, claim_items, insurance_claims  (claim_diagnoses 는 보존)
--
-- CASCADE 주의: insurance_claims DROP CASCADE 는 claim_diagnoses.claim_id 가
--   insurance_claims 를 참조하는 FK 가 있을 경우 그 "FK 제약조건만" 제거한다(테이블/행 보존).
--   prod claim_diagnoses 는 적용 전 insurance_claims 부재 상태에서 생성되었으므로
--   해당 FK 가 없을 것으로 예상(verify 스크립트 fk_claim_diag_to_claims 프로브로 확인).
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS edi_submissions CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS insurance_claims CASCADE;

-- claim_diagnoses 는 의도적으로 DROP 하지 않는다 (배치 외 선존재 테이블 보존).
DROP FUNCTION IF EXISTS update_insurance_claims_updated_at() CASCADE;

COMMIT;

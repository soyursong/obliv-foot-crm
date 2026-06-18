-- ROLLBACK: T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY
-- 무손실 원상복귀 — ADD 한 것만 DROP. 기존 데이터/컬럼/제약 무영향.
--   · DROP VIEW v_foot_drug_master
--   · DROP INDEX idx_prescription_codes_service_id
--   · DROP COLUMN prescription_codes.service_id (백필된 링크값도 함께 소멸 — 단 prescription_codes 행 자체·
--     services 행·약품폴더 매핑 전부 보존. service_id 는 순수 부가 브릿지였으므로 유실 0).
-- ⚠ 백필을 _backfill_apply 로 이미 실행한 상태에서 롤백하면 service_id 링크값이 사라짐(재백필 가능).
--   원본 약·폴더·HIRA 메타는 그대로 → 기능 회귀 없음.

BEGIN;

DROP VIEW IF EXISTS v_foot_drug_master;

DROP INDEX IF EXISTS idx_prescription_codes_service_id;

ALTER TABLE prescription_codes
  DROP COLUMN IF EXISTS service_id;

COMMIT;

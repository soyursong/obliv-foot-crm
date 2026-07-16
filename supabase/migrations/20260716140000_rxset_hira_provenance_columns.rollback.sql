-- ROLLBACK — T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY provenance 4컬럼 (20260716140000_rxset_hira_provenance_columns.sql)
-- ADDITIVE 4컬럼 제거. NULL default·매칭 미기록 시 손실 없음.
-- ⚠ DML(20260716140500_rxset_flunacoem_map_apply.sql) 이 이미 적용됐다면 그 rollback 을 먼저 실행할 것
--   (DML 이 이 컬럼들에 값을 적재하므로 순서 역전 시 provenance 소실).

BEGIN;

ALTER TABLE prescription_codes
  DROP COLUMN IF EXISTS hira_verified_at,
  DROP COLUMN IF EXISTS hira_match_basis,
  DROP COLUMN IF EXISTS hira_mapped_to_code_id,
  DROP COLUMN IF EXISTS hira_verified_by;

COMMIT;

-- Rollback: T-20260504-foot-INSURANCE-COPAYMENT
DROP FUNCTION IF EXISTS calc_copayment(UUID, UUID, UUID, DATE);
DROP TABLE IF EXISTS service_charges;

DROP INDEX IF EXISTS idx_services_hira_code;
ALTER TABLE services
  DROP COLUMN IF EXISTS copayment_rate_override,
  DROP COLUMN IF EXISTS hira_category,
  DROP COLUMN IF EXISTS hira_score,
  DROP COLUMN IF EXISTS hira_code,
  DROP COLUMN IF EXISTS is_insurance_covered;

DROP INDEX IF EXISTS idx_customers_insurance_grade;
ALTER TABLE customers
  DROP COLUMN IF EXISTS insurance_grade_memo,
  DROP COLUMN IF EXISTS insurance_grade_source,
  DROP COLUMN IF EXISTS insurance_grade_verified_at,
  DROP COLUMN IF EXISTS insurance_grade,
  DROP COLUMN IF EXISTS rrn_vault_id;

ALTER TABLE clinics
  DROP COLUMN IF EXISTS hira_unit_value_year,
  DROP COLUMN IF EXISTS hira_unit_value;

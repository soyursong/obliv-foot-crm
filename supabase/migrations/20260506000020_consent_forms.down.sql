-- ROLLBACK: T-20260430-foot-CONSENT-FORMS
DROP INDEX IF EXISTS idx_consent_forms_clinic;
DROP INDEX IF EXISTS idx_consent_forms_check_in;
DROP INDEX IF EXISTS idx_consent_forms_customer;
DROP TABLE IF EXISTS consent_forms;

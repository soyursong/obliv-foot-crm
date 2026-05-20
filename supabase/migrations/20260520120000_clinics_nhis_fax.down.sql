-- Rollback: 20260520120000_clinics_nhis_fax.sql
ALTER TABLE clinics
  DROP COLUMN IF EXISTS nhis_code,
  DROP COLUMN IF EXISTS fax;

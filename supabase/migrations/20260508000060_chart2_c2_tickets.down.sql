-- Rollback: 20260508000060_chart2_c2_tickets.sql
ALTER TABLE customers
  DROP COLUMN IF EXISTS hira_consent,
  DROP COLUMN IF EXISTS hira_consent_at,
  DROP COLUMN IF EXISTS visit_route,
  DROP COLUMN IF EXISTS assigned_staff_id;

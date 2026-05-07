-- Rollback: T-20260507-foot-PKG-TEMPLATE-REDESIGN
DROP POLICY IF EXISTS "auth_all" ON package_templates;
ALTER TABLE packages DROP COLUMN IF EXISTS template_id;
ALTER TABLE packages DROP COLUMN IF EXISTS iv_company;
ALTER TABLE packages DROP COLUMN IF EXISTS podologe_unit_price;
ALTER TABLE packages DROP COLUMN IF EXISTS podologe_sessions;
DROP TABLE IF EXISTS package_templates;

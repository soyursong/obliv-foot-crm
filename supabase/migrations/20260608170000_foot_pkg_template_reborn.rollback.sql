-- Rollback: T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT
-- package_templates 의 Re:Born 컬럼 제거 (additive 컬럼 → DROP 안전)

ALTER TABLE package_templates DROP COLUMN IF EXISTS reborn_sessions;
ALTER TABLE package_templates DROP COLUMN IF EXISTS reborn_unit_price;

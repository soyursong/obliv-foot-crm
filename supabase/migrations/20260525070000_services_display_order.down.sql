-- T-20260525-foot-FEE-ITEM-REORDER AC-6 — ROLLBACK
-- services.display_order 컬럼 제거

DROP INDEX IF EXISTS idx_services_clinic_display_order;
ALTER TABLE services DROP COLUMN IF EXISTS display_order;

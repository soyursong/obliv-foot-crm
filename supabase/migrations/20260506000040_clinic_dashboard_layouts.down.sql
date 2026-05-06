-- ROLLBACK: T-20260506-foot-LAYOUT-DEFAULT-SAVE
-- clinic_dashboard_layouts 테이블 및 관련 정책 삭제

DROP POLICY IF EXISTS "clinic_dashboard_layouts_delete" ON clinic_dashboard_layouts;
DROP POLICY IF EXISTS "clinic_dashboard_layouts_update" ON clinic_dashboard_layouts;
DROP POLICY IF EXISTS "clinic_dashboard_layouts_insert" ON clinic_dashboard_layouts;
DROP POLICY IF EXISTS "clinic_dashboard_layouts_select" ON clinic_dashboard_layouts;
DROP INDEX IF EXISTS clinic_dashboard_layouts_clinic_idx;
DROP TABLE IF EXISTS clinic_dashboard_layouts;

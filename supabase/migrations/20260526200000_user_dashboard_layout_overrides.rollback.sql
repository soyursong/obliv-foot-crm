-- ROLLBACK: T-20260526-foot-LAYOUT-USER-CUSTOM
-- user_dashboard_layout_overrides 테이블 및 관련 정책/인덱스 삭제

DROP POLICY IF EXISTS "udlo_delete" ON user_dashboard_layout_overrides;
DROP POLICY IF EXISTS "udlo_update" ON user_dashboard_layout_overrides;
DROP POLICY IF EXISTS "udlo_insert" ON user_dashboard_layout_overrides;
DROP POLICY IF EXISTS "udlo_select" ON user_dashboard_layout_overrides;
DROP INDEX IF EXISTS udlo_user_idx;
DROP INDEX IF EXISTS udlo_clinic_idx;
DROP TABLE IF EXISTS user_dashboard_layout_overrides;

-- ROLLBACK: T-20260624-foot-ASSIGN-STAFF-TEMP-OFF
-- staff_temp_off 신규 테이블 제거. ADDITIVE 순수신설이므로 DROP 으로 완전 원복(기존 스키마 영향 0).
BEGIN;

DROP POLICY IF EXISTS "approved_clinic_staff_temp_off_all" ON staff_temp_off;
DROP INDEX IF EXISTS idx_staff_temp_off_workdate;
DROP TABLE IF EXISTS staff_temp_off;

COMMIT;

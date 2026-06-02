-- ROLLBACK: T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET
-- floor 운영 role 대시보드 고객 이동 UPDATE 정책 제거.
-- 제거 시 직원(비-admin) 고객 이동이 다시 admin/manager 한정으로 차단됨(원복).
BEGIN;
DROP POLICY IF EXISTS check_ins_floor_dashboard_update ON check_ins;
COMMIT;

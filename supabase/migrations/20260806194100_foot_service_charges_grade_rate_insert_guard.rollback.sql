-- ROLLBACK — 20260806194100_foot_service_charges_grade_rate_insert_guard.sql
-- T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — AC-1/AC-2 가드 제거

DROP TRIGGER IF EXISTS trg_service_charges_grade_rate_guard ON service_charges;
DROP FUNCTION IF EXISTS foot_service_charges_grade_rate_guard();

-- ============================================================
-- ROLLBACK: T-20260522-foot-STAFF-ROLE-PERM-GAP
-- ============================================================

BEGIN;

-- 1. payments: coordinator/therapist INSERT 정책 제거
DROP POLICY IF EXISTS payments_coord_insert  ON payments;
DROP POLICY IF EXISTS payments_therap_insert ON payments;

-- 2. package_sessions: coordinator INSERT/UPDATE 정책 제거
DROP POLICY IF EXISTS package_sessions_coord_insert ON package_sessions;
DROP POLICY IF EXISTS package_sessions_coord_update ON package_sessions;

-- 3. check_in_services: coordinator/therapist INSERT + DELETE 정책 제거
DROP POLICY IF EXISTS check_in_services_coord_insert  ON check_in_services;
DROP POLICY IF EXISTS check_in_services_therap_insert ON check_in_services;
DROP POLICY IF EXISTS check_in_services_coord_delete  ON check_in_services;
DROP POLICY IF EXISTS check_in_services_therap_delete ON check_in_services;

-- 4. form_templates required_role 원복
--    4a. 임상 행정 서류 → coordinator 포함, consultant/therapist 제외로 원복
UPDATE form_templates
   SET required_role = 'admin|manager|director|coordinator'
 WHERE form_key IN (
   'bill_detail',
   'treat_confirm',
   'treat_confirm_code',
   'treat_confirm_nocode',
   'visit_confirm'
 );

UPDATE form_templates
   SET required_role = 'admin|manager|coordinator'
 WHERE form_key IN (
   'bill_receipt',
   'med_record_short',
   'med_record_long',
   'medical_record_request'
 );

--    4b. 보험청구서 원복
UPDATE form_templates
   SET required_role = 'admin|manager|coordinator'
 WHERE form_key = 'ins_claim_form';

COMMIT;

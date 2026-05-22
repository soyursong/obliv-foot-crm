-- ============================================================
-- T-20260522-foot-STAFF-ROLE-PERM-GAP
-- consultant / coordinator / therapist 3역할 권한 갭 해소
--
-- 현장 보고 4건:
--   1) 서류출력 인쇄 실패 → form_templates.required_role 미포함
--   2) 수납처리 저장실패  → payments INSERT RLS 차단
--   3) 선수금차감 안 됨   → package_sessions INSERT/UPDATE RLS 차단
--   4) 수납목록 이탈 소실 → check_in_services INSERT RLS 차단
--
-- 거버넌스 준수:
--   - is_floor_staff() 절대 사용 금지
--   - generic staff / part_lead 권한 미부여
--   - consultant_or_above / coordinator_or_above / therapist_or_technician 함수만 사용
--
-- Rollback: 20260522100000_staff_role_perm_gap.down.sql
-- Ticket:   T-20260522-foot-STAFF-ROLE-PERM-GAP
-- ============================================================

BEGIN;

-- ============================================================
-- 1. payments: coordinator / therapist INSERT 추가
--    기존: payments_consult_insert → is_consultant_or_above() AND payment_type='payment'
--    신규: coordinator / therapist도 payment_type='payment' INSERT 허용
-- ============================================================

DROP POLICY IF EXISTS payments_coord_insert  ON payments;
DROP POLICY IF EXISTS payments_therap_insert ON payments;

CREATE POLICY payments_coord_insert ON payments FOR INSERT TO authenticated
  WITH CHECK (
    is_coordinator_or_above()
    AND payment_type = 'payment'
  );

COMMENT ON POLICY payments_coord_insert ON payments IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: coordinator 수납처리 저장 허용 (payment_type=payment 한정).';

CREATE POLICY payments_therap_insert ON payments FOR INSERT TO authenticated
  WITH CHECK (
    is_therapist_or_technician()
    AND payment_type = 'payment'
  );

COMMENT ON POLICY payments_therap_insert ON payments IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: therapist 수납처리 저장 허용 (payment_type=payment 한정).';

-- ============================================================
-- 2. package_sessions: coordinator INSERT / UPDATE 추가
--    기존: consult INSERT/UPDATE + therap INSERT/UPDATE (자기 배정건만)
--    신규: coordinator INSERT/UPDATE 추가 → 선수금차감 가능
-- ============================================================

DROP POLICY IF EXISTS package_sessions_coord_insert ON package_sessions;
DROP POLICY IF EXISTS package_sessions_coord_update ON package_sessions;

CREATE POLICY package_sessions_coord_insert ON package_sessions FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());

COMMENT ON POLICY package_sessions_coord_insert ON package_sessions IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: coordinator 패키지 회차 기록 INSERT 허용.';

CREATE POLICY package_sessions_coord_update ON package_sessions FOR UPDATE TO authenticated
  USING (is_coordinator_or_above())
  WITH CHECK (is_coordinator_or_above());

COMMENT ON POLICY package_sessions_coord_update ON package_sessions IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: coordinator 패키지 회차 UPDATE 허용 (선수금차감 흐름).';

-- ============================================================
-- 3. check_in_services: coordinator / therapist INSERT 추가
--    기존: consult ALL + admin ALL + approved READ
--    신규: coordinator INSERT + therapist INSERT
--    UPDATE는 비허용 (가격 수정은 consultant/admin 전용 유지)
-- ============================================================

DROP POLICY IF EXISTS check_in_services_coord_insert  ON check_in_services;
DROP POLICY IF EXISTS check_in_services_therap_insert ON check_in_services;

CREATE POLICY check_in_services_coord_insert ON check_in_services FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());

COMMENT ON POLICY check_in_services_coord_insert ON check_in_services IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: coordinator 수납목록(시술항목) INSERT 허용.';

CREATE POLICY check_in_services_therap_insert ON check_in_services FOR INSERT TO authenticated
  WITH CHECK (is_therapist_or_technician());

COMMENT ON POLICY check_in_services_therap_insert ON check_in_services IS
  'T-20260522-foot-STAFF-ROLE-PERM-GAP: therapist 시술항목 INSERT 허용. UPDATE(가격수정)는 consultant/admin 전용 유지.';

-- ============================================================
-- 4. form_templates required_role: 임상 서류에 3역할 추가
--
--    확장 대상 form_key (진료확인·통원확인·진료비·의무기록 등 임상 행정 서류):
--      bill_detail, bill_receipt, treat_confirm, treat_confirm_code,
--      treat_confirm_nocode, visit_confirm, med_record_short, med_record_long,
--      medical_record_request
--
--    유지 대상 (의학 권한·법정 양식 — 변경 금지):
--      diag_opinion, diag_opinion_v2, diagnosis, rx_standard,
--      prescription, referral_letter, payment_cert
--
--    ins_claim_form: coordinator+consultant만 (therapist는 보험청구 불해당)
-- ============================================================

-- 4a. 임상 행정 서류 → 3역할 전체 허용
UPDATE form_templates
   SET required_role = 'admin|manager|director|consultant|coordinator|therapist'
 WHERE form_key IN (
   'bill_detail',
   'bill_receipt',
   'treat_confirm',
   'treat_confirm_code',
   'treat_confirm_nocode',
   'visit_confirm',
   'med_record_short',
   'med_record_long',
   'medical_record_request'
 );

-- 4b. 보험청구서 → consultant+coordinator (therapist 제외)
UPDATE form_templates
   SET required_role = 'admin|manager|director|consultant|coordinator'
 WHERE form_key = 'ins_claim_form';

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 확인용)
-- ============================================================
-- SELECT policyname, cmd
--   FROM pg_policies
--  WHERE tablename IN ('payments','package_sessions','check_in_services')
--    AND policyname LIKE '%coord%' OR policyname LIKE '%therap%'
--  ORDER BY tablename, policyname;
--
-- SELECT form_key, required_role
--   FROM form_templates
--  WHERE form_key IN ('bill_detail','treat_confirm','ins_claim_form')
--  ORDER BY form_key;

COMMIT;

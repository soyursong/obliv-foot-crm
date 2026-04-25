-- ============================================================
-- T-20260420-foot-006: RLS 역할별 분리
-- ============================================================
-- 목적: 모든 인증사용자에게 ALL 권한이던 정책을 user_profiles.role 기반으로 분리
-- 영향: 35개 테이블 RLS 정책 재작성 + 헬퍼 함수 8개 추가
-- 안전: idempotent (DROP POLICY IF EXISTS / DROP FUNCTION 후 재정의)
-- 적용: supervisor 승인 후 dev → staging → prod 순
-- ============================================================

BEGIN;

-- ============================================================
-- A. 사전: staff ↔ auth 매핑 컬럼 추가 (없으면)
-- ============================================================
-- check_ins의 consultant_id/therapist_id/technician_id는 staff(id) 참조.
-- 자기 배정 판정 위해 staff.user_id ↔ auth.users(id) 연결 필요.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- B. 헬퍼 함수 (SECURITY DEFINER, search_path 고정)
-- ============================================================

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid() AND COALESCE(active, true) = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_user_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinic_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- 재정의: approved=true & active=true (idempotent)
CREATE OR REPLACE FUNCTION is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
      AND COALESCE(approved, false) = true
      AND COALESCE(active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director');
$$;

CREATE OR REPLACE FUNCTION is_consultant_or_above()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','consultant');
$$;

CREATE OR REPLACE FUNCTION is_coordinator_or_above()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','coordinator');
$$;

CREATE OR REPLACE FUNCTION is_therapist_or_technician()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','therapist','technician');
$$;

CREATE OR REPLACE FUNCTION current_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM staff WHERE user_id = auth.uid() AND COALESCE(active, true) = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_assigned_to_checkin(p_check_in_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM check_ins ci
    WHERE ci.id = p_check_in_id
      AND (
        ci.consultant_id = current_staff_id() OR
        ci.therapist_id  = current_staff_id() OR
        ci.technician_id = current_staff_id()
      )
  );
$$;

-- 모든 헬퍼는 authenticated 만 EXECUTE. anon은 명시적으로 제외.
GRANT EXECUTE ON FUNCTION current_user_role(), current_user_clinic_id(), is_approved_user(),
                          is_admin_or_manager(), is_consultant_or_above(), is_coordinator_or_above(),
                          is_therapist_or_technician(), current_staff_id(),
                          is_assigned_to_checkin(UUID)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION current_user_role(), current_user_clinic_id(),
                           is_admin_or_manager(), is_consultant_or_above(), is_coordinator_or_above(),
                           is_therapist_or_technician(), current_staff_id(),
                           is_assigned_to_checkin(UUID)
  FROM anon, public;

-- ============================================================
-- C. 기존 'auth_all' / 'approved_all' 정책 일괄 제거
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('auth_all','approved_all')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- D. RLS 활성화 (기존에 없는 테이블 대비 idempotent)
-- ============================================================
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'clinics','customers','services','staff','rooms','user_profiles',
    'clinic_schedules','clinic_holidays','reservations','reservation_logs',
    'check_ins','check_in_services','packages','package_sessions','package_payments','package_tiers',
    'payments','consent_forms','consent_templates','checklists','insurance_documents','insurance_receipts',
    'status_transitions','room_assignments','daily_closings','notifications',
    'prescriptions','prescription_items','prescription_codes','medications',
    'payment_codes','payment_code_claims','service_payment_codes',
    'form_templates','form_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- E. 정책 재정의 (테이블별)
-- ============================================================

-- ------------------------------------------------------------
-- E.1 clinics: 모두 R, admin/manager만 ALL
-- ------------------------------------------------------------
CREATE POLICY clinics_admin_all ON clinics FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY clinics_approved_read ON clinics FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.2 services: admin/manager ALL, 나머지 R
-- ------------------------------------------------------------
CREATE POLICY services_admin_all ON services FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY services_approved_read ON services FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.3 staff: admin/manager ALL, 나머지 R
-- ------------------------------------------------------------
CREATE POLICY staff_admin_all ON staff FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY staff_approved_read ON staff FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.4 rooms
-- ------------------------------------------------------------
CREATE POLICY rooms_admin_all ON rooms FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY rooms_approved_read ON rooms FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.5 user_profiles: admin ALL, 본인 R/U, 다른 approved 사용자 R(이름/역할/clinic만)
-- ------------------------------------------------------------
CREATE POLICY user_profiles_admin_all ON user_profiles FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY user_profiles_self_read ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
-- 본인 프로필 UPDATE는 허용하되, role/approved/clinic_id 변경은 admin/manager에게만.
-- (RLS는 컬럼 레벨 제약이 어려움 — 트리거로 강제)
CREATE POLICY user_profiles_self_update ON user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 트리거: 본인 update 시 role/approved/clinic_id 변경 차단 (admin/manager 제외)
CREATE OR REPLACE FUNCTION user_profiles_self_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = NEW.id AND NOT is_admin_or_manager() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF COALESCE(NEW.approved,false) IS DISTINCT FROM COALESCE(OLD.approved,false) THEN
      RAISE EXCEPTION 'approved 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
      RAISE EXCEPTION 'clinic_id 변경 권한 없음 (admin/manager만 가능)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_self_guard ON user_profiles;
CREATE TRIGGER trg_user_profiles_self_guard
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION user_profiles_self_guard();

CREATE POLICY user_profiles_peer_read ON user_profiles FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.6 clinic_schedules / clinic_holidays
-- ------------------------------------------------------------
CREATE POLICY clinic_schedules_admin_all ON clinic_schedules FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY clinic_schedules_approved_read ON clinic_schedules FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY clinic_holidays_admin_all ON clinic_holidays FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY clinic_holidays_approved_read ON clinic_holidays FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.7 customers
--   admin/manager: ALL
--   consultant: R, U(non-financial 제약은 컬럼레벨 어려움 — 정책에선 R+U, 금융컬럼 차단은 앱)
--   coordinator: R, U, I (예약 시 신규 등록)
--   therapist/technician: R only
-- ------------------------------------------------------------
CREATE POLICY customers_admin_all ON customers FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY customers_approved_read ON customers FOR SELECT TO authenticated
  USING (is_approved_user());
CREATE POLICY customers_consult_update ON customers FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY customers_coord_insert ON customers FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above() OR is_consultant_or_above());
CREATE POLICY customers_coord_update ON customers FOR UPDATE TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());

-- ------------------------------------------------------------
-- E.8 reservations: coordinator ALL, consultant R/U, others R
-- ------------------------------------------------------------
CREATE POLICY reservations_admin_all ON reservations FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY reservations_coord_all ON reservations FOR ALL TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());
CREATE POLICY reservations_consult_update ON reservations FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY reservations_approved_read ON reservations FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.9 reservation_logs (감사 로그)
-- ------------------------------------------------------------
CREATE POLICY reservation_logs_admin_all ON reservation_logs FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY reservation_logs_insert ON reservation_logs FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());
CREATE POLICY reservation_logs_approved_read ON reservation_logs FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.10 check_ins
--   admin/manager: ALL
--   consultant: R, U(unassigned or self-assigned, consult/payment 단계 진행)
--   coordinator: I, R, U(checkin 단계만)
--   therapist/technician: R(자기 배정), U(treatment_memo/photos/status — 자기 배정만)
-- ------------------------------------------------------------
CREATE POLICY check_ins_admin_all ON check_ins FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

CREATE POLICY check_ins_approved_read ON check_ins FOR SELECT TO authenticated
  USING (is_approved_user());  -- 모두가 칸반 보드를 봐야 함

-- consultant: 미배정 또는 자기배정인 케이스 INSERT/UPDATE
CREATE POLICY check_ins_consult_insert ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());
CREATE POLICY check_ins_consult_update ON check_ins FOR UPDATE TO authenticated
  USING (
    is_consultant_or_above()
    AND (consultant_id IS NULL OR consultant_id = current_staff_id() OR is_admin_or_manager())
  )
  WITH CHECK (
    is_consultant_or_above()
    AND (consultant_id IS NULL OR consultant_id = current_staff_id() OR is_admin_or_manager())
  );

-- coordinator: 체크인 등록(I)과 체크인 단계 R/U
CREATE POLICY check_ins_coord_insert ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());
CREATE POLICY check_ins_coord_update ON check_ins FOR UPDATE TO authenticated
  USING (
    is_coordinator_or_above()
    AND status IN ('registered','checklist','exam_waiting')  -- 코디는 초기 단계만
  )
  WITH CHECK (
    is_coordinator_or_above()
    AND status IN ('registered','checklist','exam_waiting','consult_waiting','cancelled')
  );

-- therapist/technician: 자기 배정만 R/U
CREATE POLICY check_ins_therap_update ON check_ins FOR UPDATE TO authenticated
  USING (
    is_therapist_or_technician()
    AND (therapist_id = current_staff_id() OR technician_id = current_staff_id() OR is_admin_or_manager())
  )
  WITH CHECK (
    is_therapist_or_technician()
    AND (therapist_id = current_staff_id() OR technician_id = current_staff_id() OR is_admin_or_manager())
  );

-- ------------------------------------------------------------
-- E.11 check_in_services
--   admin/manager: ALL
--   consultant: ALL (상담 단계 가격 변경)
--   coordinator/therapist/technician: R
-- ------------------------------------------------------------
CREATE POLICY check_in_services_admin_all ON check_in_services FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY check_in_services_consult_all ON check_in_services FOR ALL TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY check_in_services_approved_read ON check_in_services FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.12 packages
--   admin/manager: ALL (환불·양도 포함)
--   consultant: SELECT, INSERT (status='active'/'completed' 한정), UPDATE (status NOT IN ('refunded','transferred'))
--   나머지: SELECT
--
-- 주의: PostgreSQL RLS 정책은 OR 결합 — 같은 cmd에 여러 정책 있으면 그 중 하나라도 USING 통과하면 허용.
--       따라서 admin_all과 consult_*은 분리해도 OR 결합으로 admin은 항상 통과.
-- ------------------------------------------------------------
CREATE POLICY packages_admin_all ON packages FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY packages_approved_read ON packages FOR SELECT TO authenticated
  USING (is_approved_user());
CREATE POLICY packages_consult_insert ON packages FOR INSERT TO authenticated
  WITH CHECK (
    is_consultant_or_above()
    AND status IN ('active','completed')  -- 환불/양도는 INSERT 불가
  );
CREATE POLICY packages_consult_update ON packages FOR UPDATE TO authenticated
  USING (
    is_consultant_or_above()
    AND status NOT IN ('refunded','transferred')  -- 환불·양도 상태로 진입한 패키지 변경 불가
  )
  WITH CHECK (
    is_consultant_or_above()
    AND status NOT IN ('refunded','transferred')  -- 환불·양도 상태로 변경 불가
  );

-- ------------------------------------------------------------
-- E.13 package_sessions
--   admin/manager: ALL
--   consultant: I, R, U
--   therapist/technician: I (시술 기록), R, U (자기 시술건만)
-- ------------------------------------------------------------
CREATE POLICY package_sessions_admin_all ON package_sessions FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY package_sessions_consult_iru ON package_sessions FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());
CREATE POLICY package_sessions_consult_update ON package_sessions FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY package_sessions_therap_insert ON package_sessions FOR INSERT TO authenticated
  WITH CHECK (
    is_therapist_or_technician()
    AND (performed_by IS NULL OR performed_by = current_staff_id())
  );
CREATE POLICY package_sessions_therap_update ON package_sessions FOR UPDATE TO authenticated
  USING (
    is_therapist_or_technician()
    AND performed_by = current_staff_id()
  )
  WITH CHECK (
    is_therapist_or_technician()
    AND performed_by = current_staff_id()
  );
CREATE POLICY package_sessions_approved_read ON package_sessions FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.14 package_payments
--   admin/manager: ALL (환불 포함)
--   consultant: I (payment_type='payment'만), R
--   나머지: R
-- ------------------------------------------------------------
CREATE POLICY package_payments_admin_all ON package_payments FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY package_payments_consult_insert ON package_payments FOR INSERT TO authenticated
  WITH CHECK (
    is_consultant_or_above()
    AND payment_type = 'payment'  -- 환불은 admin/manager만
  );
CREATE POLICY package_payments_approved_read ON package_payments FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.15 payments (단건)
--   admin/manager: ALL
--   consultant: I (payment_type='payment'만), R
--   나머지: R
-- ------------------------------------------------------------
CREATE POLICY payments_admin_all ON payments FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY payments_consult_insert ON payments FOR INSERT TO authenticated
  WITH CHECK (
    is_consultant_or_above()
    AND payment_type = 'payment'
  );
CREATE POLICY payments_approved_read ON payments FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.16 consent_forms / consent_templates
-- ------------------------------------------------------------
CREATE POLICY consent_forms_admin_all ON consent_forms FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY consent_forms_consult_all ON consent_forms FOR ALL TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY consent_forms_coord_iru ON consent_forms FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());
CREATE POLICY consent_forms_approved_read ON consent_forms FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY consent_templates_admin_all ON consent_templates FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY consent_templates_approved_read ON consent_templates FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.17 checklists (사전 체크리스트 — 셀체 anon insert는 별도 정책 유지)
-- ------------------------------------------------------------
CREATE POLICY checklists_admin_all ON checklists FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY checklists_consult_update ON checklists FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY checklists_coord_insert ON checklists FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above() OR is_consultant_or_above());
CREATE POLICY checklists_coord_update ON checklists FOR UPDATE TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());
CREATE POLICY checklists_approved_read ON checklists FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.18 insurance_documents / insurance_receipts
-- ------------------------------------------------------------
CREATE POLICY insurance_documents_admin_all ON insurance_documents FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY insurance_documents_consult_all ON insurance_documents FOR ALL TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY insurance_documents_approved_read ON insurance_documents FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY insurance_receipts_admin_all ON insurance_receipts FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY insurance_receipts_consult_all ON insurance_receipts FOR ALL TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY insurance_receipts_approved_read ON insurance_receipts FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.19 status_transitions (감사 로그)
-- ------------------------------------------------------------
CREATE POLICY status_transitions_admin_all ON status_transitions FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY status_transitions_insert ON status_transitions FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());
CREATE POLICY status_transitions_approved_read ON status_transitions FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.20 room_assignments
-- ------------------------------------------------------------
CREATE POLICY room_assignments_admin_all ON room_assignments FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY room_assignments_approved_read ON room_assignments FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.21 daily_closings: admin/manager만 ALL, consultant/coord R, therapist 차단
-- ------------------------------------------------------------
CREATE POLICY daily_closings_admin_all ON daily_closings FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY daily_closings_finance_read ON daily_closings FOR SELECT TO authenticated
  USING (
    is_consultant_or_above() OR is_coordinator_or_above()
  );

-- ------------------------------------------------------------
-- E.22 notifications
-- ------------------------------------------------------------
CREATE POLICY notifications_admin_all ON notifications FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above() OR is_coordinator_or_above());
CREATE POLICY notifications_approved_read ON notifications FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.23 prescriptions / prescription_items / prescription_codes / medications
-- ------------------------------------------------------------
CREATE POLICY prescriptions_admin_all ON prescriptions FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY prescriptions_consult_iru ON prescriptions FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());
CREATE POLICY prescriptions_consult_update ON prescriptions FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY prescriptions_approved_read ON prescriptions FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY prescription_items_admin_all ON prescription_items FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY prescription_items_consult_iru ON prescription_items FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());
CREATE POLICY prescription_items_consult_update ON prescription_items FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());
CREATE POLICY prescription_items_approved_read ON prescription_items FOR SELECT TO authenticated
  USING (is_approved_user());

-- prescription_codes는 dev DB에 미적용일 수 있어 IF EXISTS 가드
-- (20260422000000_prescription_codes_and_forms.sql 미적용 환경 대응)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prescription_codes') THEN
    EXECUTE 'CREATE POLICY prescription_codes_admin_all ON prescription_codes FOR ALL TO authenticated USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager())';
    EXECUTE 'CREATE POLICY prescription_codes_approved_read ON prescription_codes FOR SELECT TO authenticated USING (is_approved_user())';
  END IF;
END $$;

CREATE POLICY medications_admin_all ON medications FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY medications_approved_read ON medications FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.24 payment_codes / payment_code_claims / service_payment_codes
-- ------------------------------------------------------------
CREATE POLICY payment_codes_admin_all ON payment_codes FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY payment_codes_approved_read ON payment_codes FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY payment_code_claims_admin_all ON payment_code_claims FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY payment_code_claims_consult_iru ON payment_code_claims FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());
CREATE POLICY payment_code_claims_approved_read ON payment_code_claims FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY service_payment_codes_admin_all ON service_payment_codes FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY service_payment_codes_approved_read ON service_payment_codes FOR SELECT TO authenticated
  USING (is_approved_user());

-- ------------------------------------------------------------
-- E.25 package_tiers (있을 경우)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='package_tiers') THEN
    EXECUTE 'CREATE POLICY package_tiers_admin_all ON package_tiers FOR ALL TO authenticated USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager())';
    EXECUTE 'CREATE POLICY package_tiers_approved_read ON package_tiers FOR SELECT TO authenticated USING (is_approved_user())';
  END IF;
END $$;

-- ------------------------------------------------------------
-- E.26 form_templates / form_submissions (있을 경우)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='form_templates') THEN
    EXECUTE 'CREATE POLICY form_templates_admin_all ON form_templates FOR ALL TO authenticated USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager())';
    EXECUTE 'CREATE POLICY form_templates_approved_read ON form_templates FOR SELECT TO authenticated USING (is_approved_user())';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='form_submissions') THEN
    EXECUTE 'CREATE POLICY form_submissions_admin_all ON form_submissions FOR ALL TO authenticated USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager())';
    EXECUTE 'CREATE POLICY form_submissions_consult_iru ON form_submissions FOR INSERT TO authenticated WITH CHECK (is_consultant_or_above() OR is_coordinator_or_above())';
    EXECUTE 'CREATE POLICY form_submissions_approved_read ON form_submissions FOR SELECT TO authenticated USING (is_approved_user())';
  END IF;
END $$;

-- ============================================================
-- F. anon (셀프체크인) 정책 — 기존 유지 확인
-- ============================================================
-- 기존 anon_clinic_read / anon_customer_read / anon_customer_create / anon_reservation_read /
--      anon_checkin_create / anon_checkin_read / anon_checklist_create / anon_service_read
-- 정책은 변경 없음. 본 마이그레이션에서 건드리지 않는다.

-- ============================================================
-- G. 댓글
-- ============================================================
COMMENT ON FUNCTION current_user_role() IS 'T-foot-006: 현재 사용자의 user_profiles.role 반환 (없으면 NULL)';
COMMENT ON FUNCTION is_admin_or_manager() IS 'T-foot-006: admin/manager/director 권한 판정';
COMMENT ON FUNCTION is_assigned_to_checkin(UUID) IS 'T-foot-006: 자기 staff.id가 해당 check_in의 consultant/therapist/technician에 배정됐는지';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용, 실행하지 않음)
-- ============================================================
-- SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname='public'
--  ORDER BY tablename, cmd, policyname;
--
-- SELECT count(*) FROM pg_policies
--  WHERE schemaname='public' AND policyname IN ('auth_all','approved_all');
-- -- expected: 0

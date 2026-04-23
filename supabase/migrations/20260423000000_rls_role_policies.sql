-- T-20260420-foot-006: 역할별 RLS 정책 분리
-- 기존 auth_all (모든 authenticated full access) 을 role 기반 정책으로 교체.
--
-- 정책 요약:
--   admin/manager   : 모든 테이블 ALL
--   consultant      : 상담/결제 범위 쓰기, 패키지·환불·마감 금지
--   coordinator     : 체크인 생성·고객 관리, 패키지 생성 허용, 환불·마감 금지
--   therapist       : 체크인 SELECT 모두 + 자기 배정 check_in UPDATE만. 결제/패키지/마감 금지
--   technician/staff/tm : SELECT 기본 허용, INSERT/UPDATE 제한

-- ============================================================
-- 1. helper 함수
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role::text FROM user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role IN ('admin','manager'), FALSE)
  FROM user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_staff_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id FROM staff WHERE user_id = auth.uid() LIMIT 1
$$;

-- ============================================================
-- 2. 기존 auth_all 정책 DROP
-- ============================================================

DROP POLICY IF EXISTS "auth_all" ON packages;
DROP POLICY IF EXISTS "auth_all" ON package_sessions;
DROP POLICY IF EXISTS "auth_all" ON package_payments;
DROP POLICY IF EXISTS "auth_all" ON payments;
DROP POLICY IF EXISTS "auth_all" ON daily_closings;
DROP POLICY IF EXISTS "auth_all" ON check_ins;
DROP POLICY IF EXISTS "auth_all" ON user_profiles;

-- ============================================================
-- 3. packages / package_sessions / package_payments
--    SELECT: authenticated 모두 / WRITE: admin|manager|consultant|coordinator
--    환불 (refund_amount 있는 UPDATE) : admin|manager 만 — 어플 레벨 가드 + DB 가드
-- ============================================================

CREATE POLICY "packages_read" ON packages FOR SELECT TO authenticated USING (true);
CREATE POLICY "packages_insert" ON packages FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));
CREATE POLICY "packages_update" ON packages FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','manager','consultant','coordinator'))
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));
CREATE POLICY "packages_delete_admin" ON packages FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager());

CREATE POLICY "package_sessions_read" ON package_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "package_sessions_write" ON package_sessions FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager','consultant','coordinator','therapist'))
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator','therapist'));

CREATE POLICY "package_payments_read" ON package_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "package_payments_write" ON package_payments FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager','consultant','coordinator'))
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));

-- ============================================================
-- 4. payments (환불 포함)
--    SELECT: authenticated 모두 / WRITE: admin|manager|consultant|coordinator
--    DELETE: admin|manager 만
-- ============================================================

CREATE POLICY "payments_read" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','manager','consultant','coordinator'))
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));
CREATE POLICY "payments_delete_admin" ON payments FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager());

-- ============================================================
-- 5. daily_closings
--    SELECT: authenticated 모두 / WRITE: admin|manager 만
-- ============================================================

CREATE POLICY "daily_closings_read" ON daily_closings FOR SELECT TO authenticated USING (true);
CREATE POLICY "daily_closings_write" ON daily_closings FOR ALL TO authenticated
  USING (current_user_is_admin_or_manager())
  WITH CHECK (current_user_is_admin_or_manager());

-- ============================================================
-- 6. check_ins
--    SELECT: authenticated 모두
--    INSERT: admin|manager|consultant|coordinator (프런트데스크 업무)
--    UPDATE: admin|manager|consultant|coordinator 전체 / therapist 는 자기 배정만
--    DELETE: admin|manager 만
-- ============================================================

CREATE POLICY "check_ins_read" ON check_ins FOR SELECT TO authenticated USING (true);

CREATE POLICY "check_ins_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));

CREATE POLICY "check_ins_update_privileged" ON check_ins FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','manager','consultant','coordinator'))
  WITH CHECK (current_user_role() IN ('admin','manager','consultant','coordinator'));

-- therapist: therapist_id 가 자기 staff.id 와 일치하는 check_in 만 UPDATE
CREATE POLICY "check_ins_update_therapist_own" ON check_ins FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'therapist'
    AND therapist_id = current_user_staff_id()
  )
  WITH CHECK (
    current_user_role() = 'therapist'
    AND therapist_id = current_user_staff_id()
  );

CREATE POLICY "check_ins_delete_admin" ON check_ins FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager());

-- ============================================================
-- 7. user_profiles
--    SELECT: 본인 + admin 모두
--    UPDATE: 본인 (name/email 제한은 어플 가드) + admin 모두
--    INSERT: admin (가입 시 signup_profile_insert 트리거가 생성)
-- ============================================================

CREATE POLICY "user_profiles_read_own" ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR current_user_role() = 'admin');

CREATE POLICY "user_profiles_update_own_or_admin" ON user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR current_user_role() = 'admin')
  WITH CHECK (id = auth.uid() OR current_user_role() = 'admin');

CREATE POLICY "user_profiles_insert_admin" ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (current_user_role() = 'admin' OR id = auth.uid());

CREATE POLICY "user_profiles_delete_admin" ON user_profiles FOR DELETE TO authenticated
  USING (current_user_role() = 'admin');

-- ============================================================
-- 주의
-- ============================================================
-- - 나머지 테이블 (customers, reservations, services, staff, rooms, clinic_*,
--   check_in_services, consent_forms, checklists, insurance_documents,
--   status_transitions, room_assignments, notifications) 은 auth_all 유지.
--   → 현장 운영상 전 직원이 참조/기록해야 하는 영역.
-- - therapist 쓰기 가드 세밀화(예: payments/packages 직접 호출 차단)는 어플 레벨
--   `RoleGuard` (App.tsx) 에서 이미 진입 차단 중 — DB 가드는 방어선.

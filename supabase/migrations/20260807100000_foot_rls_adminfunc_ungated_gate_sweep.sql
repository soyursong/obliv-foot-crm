-- ============================================================================
-- T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP  (STEP3 remediation)
-- change-class: (C) security-TIGHTENING  → §3.1 CEO 파괴게이트 면제 (DA GO)
-- DA SSOT: agents/docs/da_replies/da_decision_foot_rls_adminfunc_ungated_phileak_inherit_sweep_20260806.md
--          (committed a40248a1a8e)  · STEP1 census: commit c202008a
--
-- 목적: approved∧active 게이트(is_approved_user()) 누락으로 미승인/비활성 계정이
--       PHI·finance write/delete/read 를 유지하는 누수를, role-set 을 보존한 채
--       fail-closed narrowing 으로 봉합한다.  data mutation 0 · 스키마 DROP 0 · 가역.
--
-- ── forward-only 하드가드 (DA §DA-ask5) ──────────────────────────────────────
-- 3 ungated 헬퍼는 공유 계보 `20260423000000_rls_role_policies.sql`(타 fork 상속)
-- 정의다.  historical migration 을 절대 in-place mutate 하지 않고, 본 신규 foot
-- 타임스탬프 마이그가 forward CREATE OR REPLACE 로 gated 정의를 얹는다.
-- down(.rollback.sql) = pre-STEP3 정의(ungated) 정확 복원.
--
-- ── 지배 규칙 (DA §DA-ask2, HARD) ────────────────────────────────────────────
--   ②-conjoin      = is_approved_user() AND (기존 술어 전문)   ← OR구조/모든 leg 보존
--   ③ own-leg EXEMPT = own_leg OR (is_approved_user() AND role_leg)
--   6menu          = ②-conjoin + role-set {consultant,coordinator,therapist} 보존
--   role-list-only 축약 금지 (authorship/own leg drop = 정직 스태프 false lockout)
--
-- ── 헬퍼 게이팅 = chokepoint ─────────────────────────────────────────────────
-- current_user_is_admin_or_manager() 를 게이팅하면 이를 참조하는 5 정책
--   (check_ins_delete_admin · packages_delete_admin · payments_delete_admin ·
--    daily_closings_write · insurance_sync_runs_read_admin)
-- 이 by-construction 힐링된다 → 그 5 정책은 재작성하지 않는다(chokepoint 우위).
-- is_admin()/is_manager_or_above() 는 현재 참조 정책 0 · non-authz caller 0
--   (선결 C2 census clean) → forward-safe hardening.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- PART 1 — 3 ungated 헬퍼 in-place 게이팅 (role-set 보존, is_approved_user() conjoin)
-- ─────────────────────────────────────────────────────────────────────────

-- current_user_is_admin_or_manager : role-set {admin,manager} 보존 (director 미추가)
CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_approved_user()
     AND COALESCE(role IN ('admin','manager'), FALSE)
  FROM user_profiles WHERE id = auth.uid()
$function$;

-- is_admin : role-set {ADMIN} 보존
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT public.is_approved_user()
     AND UPPER(COALESCE(public.current_user_role(), '')) = 'ADMIN';
$function$;

-- is_manager_or_above : role_level>=1 보존
CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT public.is_approved_user()
     AND public.role_level(public.current_user_role()) >= 1;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 2 — 인라인 ② privileged (bare current_user_role) ②-conjoin wrap
--          기존 술어 전문 보존 + is_approved_user() conjoin
-- ─────────────────────────────────────────────────────────────────────────

-- check_ins
ALTER POLICY check_ins_insert ON check_ins
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())));
ALTER POLICY check_ins_update_privileged ON check_ins
  USING (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())));

-- check_ins_update_therapist_own : ①→② 재분류 (carve 아님·게이트) — DA §DA-ask2
ALTER POLICY check_ins_update_therapist_own ON check_ins
  USING (is_approved_user() AND ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()) AND (clinic_id = current_user_clinic_id())));

-- customers
ALTER POLICY customers_therap_update_6menu ON customers
  USING (is_approved_user() AND ((current_user_role() = 'therapist'::text) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = 'therapist'::text) AND (clinic_id = current_user_clinic_id())));

-- package_payments / package_sessions / packages / payments
ALTER POLICY package_payments_write ON package_payments
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])));
ALTER POLICY package_sessions_write ON package_sessions
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text])));
ALTER POLICY packages_insert ON packages
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])));
ALTER POLICY packages_update ON packages
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])));
ALTER POLICY payments_insert ON payments
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())));
ALTER POLICY payments_update ON payments
  USING (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id())));

-- package_progress_plans
ALTER POLICY ppp_write ON package_progress_plans
  USING (is_approved_user() AND ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))))
  WITH CHECK (is_approved_user() AND ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))));

-- prescription_contraindications
ALTER POLICY rx_contra_admin_write ON prescription_contraindications
  USING (is_approved_user() AND (current_user_role() = 'admin'::text))
  WITH CHECK (is_approved_user() AND (current_user_role() = 'admin'::text));

-- staff (coordinator staffcrud)
ALTER POLICY staff_coordinator_insert_staffcrud ON staff
  WITH CHECK (is_approved_user() AND ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text)));
ALTER POLICY staff_coordinator_update_staffcrud ON staff
  USING (is_approved_user() AND ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text)))
  WITH CHECK (is_approved_user() AND ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text)));

-- staff_auth_action_audit
ALTER POLICY saaa_admin_read ON staff_auth_action_audit
  USING (is_approved_user() AND (current_user_role() = 'admin'::text));

-- treatment_photos (role-list 8종 보존)
ALTER POLICY treatment_photos_insert_staff ON treatment_photos
  WITH CHECK (is_approved_user() AND ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text, 'part_lead'::text, 'staff'::text]))));
ALTER POLICY treatment_photos_update_staff ON treatment_photos
  USING (is_approved_user() AND ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text, 'part_lead'::text, 'staff'::text]))))
  WITH CHECK (is_approved_user() AND (clinic_id = current_user_clinic_id()));

-- user_profiles_delete_admin (bare role='admin')
ALTER POLICY user_profiles_delete_admin ON user_profiles
  USING (is_approved_user() AND (current_user_role() = 'admin'::text));

-- form_submissions / form_submissions_audit_log (OR구조 보존)
ALTER POLICY fs_deleted_rows_director_only ON form_submissions
  USING (is_approved_user() AND ((deleted_at IS NULL) OR (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text]))));
ALTER POLICY fsal_select_director_admin ON form_submissions_audit_log
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3 — foot-native *_staff_unlock_6menu (5정책) ②-conjoin
--          role-set {consultant,coordinator,therapist} 보존 (기능 의도 존중)
--          finance-material flag (daily_closings/package_payments) = 별건 business-review
-- ─────────────────────────────────────────────────────────────────────────
ALTER POLICY daily_closings_staff_unlock_6menu ON daily_closings
  USING (is_approved_user() AND ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id())));
ALTER POLICY daily_room_status_staff_unlock_6menu ON daily_room_status
  USING (is_approved_user() AND ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id())))
  WITH CHECK (is_approved_user() AND ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id())));
ALTER POLICY package_payments_staff_unlock_6menu ON package_payments
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])));
ALTER POLICY packages_staff_unlock_6menu ON packages
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])));
ALTER POLICY services_staff_unlock_6menu ON services
  USING (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])))
  WITH CHECK (is_approved_user() AND (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 4 — ③ own-leg EXEMPT : own-leg 만 게이트 밖 (pending 스태프 self-onboarding 정당)
-- ─────────────────────────────────────────────────────────────────────────
ALTER POLICY user_profiles_read_own ON user_profiles
  USING ((id = auth.uid()) OR (is_approved_user() AND (current_user_role() = 'admin'::text)));
ALTER POLICY user_profiles_update_own_or_admin ON user_profiles
  USING ((id = auth.uid()) OR (is_approved_user() AND (current_user_role() = 'admin'::text)))
  WITH CHECK ((id = auth.uid()) OR (is_approved_user() AND (current_user_role() = 'admin'::text)));
ALTER POLICY user_profiles_insert_admin ON user_profiles
  WITH CHECK ((is_approved_user() AND (current_user_role() = 'admin'::text)) OR (id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 5 — customer_*_memos : ②-conjoin (authorship OR-leg 술어 안에 보존)
--          미승인/inactive 스태프는 자기저작 메모도 편집 불가 = 정답 (DA §DA-ask2)
-- ─────────────────────────────────────────────────────────────────────────
ALTER POLICY manage_update_ccm ON customer_consult_memos
  USING (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))))
  WITH CHECK (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))));
ALTER POLICY manage_update_crm ON customer_reservation_memos
  USING (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))))
  WITH CHECK (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))));
ALTER POLICY manage_update_ctm ON customer_treatment_memos
  USING (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))))
  WITH CHECK (is_approved_user() AND ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text]))));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 6 — chart_doctor_memos / medical_charts : ②-conjoin (PHI-max·clinic-null leg 게이트)
--          NOTE(§11): PHI 데이터층 fail-closed narrowing 이며 진료대시보드/진료관리
--          '화면(코드)' 를 수정하지 않는다. approved∧active director/admin/manager 접근
--          100% 보존(회귀 0) → 정당 의료 사용자에 behaviorally invisible.
--          DA(데이터 권위) STEP3 write GO 에 명시 포함. supervisor PHI DB-GATE 재확인.
-- ─────────────────────────────────────────────────────────────────────────
ALTER POLICY cdm_director_clinic_v2 ON chart_doctor_memos
  USING (is_approved_user() AND ((((clinic_id = (current_user_clinic_id())::text) AND (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['director'::text, 'admin'::text]))))))) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text])))))
  WITH CHECK (is_approved_user() AND ((((clinic_id = (current_user_clinic_id())::text) AND (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['director'::text, 'admin'::text]))))))) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text])))));
ALTER POLICY mc_clinic_isolated_v3 ON medical_charts
  USING (is_approved_user() AND ((clinic_id = (current_user_clinic_id())::text) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text, 'manager'::text, 'coordinator'::text])))))
  WITH CHECK (is_approved_user() AND ((clinic_id = (current_user_clinic_id())::text) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text, 'manager'::text, 'coordinator'::text])))));
ALTER POLICY mc_deleted_rows_director_only ON medical_charts
  USING (is_approved_user() AND ((is_deleted = false) OR (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text]))));

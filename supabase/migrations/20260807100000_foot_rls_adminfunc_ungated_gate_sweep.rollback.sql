-- ============================================================================
-- ROLLBACK (down) — T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
-- pre-STEP3 정의(ungated) 정확 복원. forward-only: 공유계보 20260423000000 무접촉.
-- 근거: STEP3 introspection scripts/_evidence/step3_introspect.out (I1/I2b, prod 실측).
-- ============================================================================

-- PART 1 — 3 헬퍼 ungated 원복
CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role IN ('admin','manager'), FALSE)
  FROM user_profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT UPPER(COALESCE(public.current_user_role(), '')) = 'ADMIN';
$function$;

CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT public.role_level(public.current_user_role()) >= 1;
$function$;

-- PART 2 — 인라인 ② 원복
ALTER POLICY check_ins_insert ON check_ins
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY check_ins_update_privileged ON check_ins
  USING ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY check_ins_update_therapist_own ON check_ins
  USING ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY customers_therap_update_6menu ON customers
  USING ((current_user_role() = 'therapist'::text) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = 'therapist'::text) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY package_payments_write ON package_payments
  USING (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));
ALTER POLICY package_sessions_write ON package_sessions
  USING (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text]));
ALTER POLICY packages_insert ON packages
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));
ALTER POLICY packages_update ON packages
  USING (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));
ALTER POLICY payments_insert ON payments
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY payments_update ON payments
  USING ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY ppp_write ON package_progress_plans
  USING ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])))
  WITH CHECK ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])));
ALTER POLICY rx_contra_admin_write ON prescription_contraindications
  USING (current_user_role() = 'admin'::text)
  WITH CHECK (current_user_role() = 'admin'::text);
ALTER POLICY staff_coordinator_insert_staffcrud ON staff
  WITH CHECK ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text));
ALTER POLICY staff_coordinator_update_staffcrud ON staff
  USING ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text))
  WITH CHECK ((current_user_role() = 'coordinator'::text) AND (clinic_id = current_user_clinic_id()) AND (role <> 'director'::text));
ALTER POLICY saaa_admin_read ON staff_auth_action_audit
  USING (current_user_role() = 'admin'::text);
ALTER POLICY treatment_photos_insert_staff ON treatment_photos
  WITH CHECK ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text, 'part_lead'::text, 'staff'::text])));
ALTER POLICY treatment_photos_update_staff ON treatment_photos
  USING ((clinic_id = current_user_clinic_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text, 'consultant'::text, 'coordinator'::text, 'therapist'::text, 'part_lead'::text, 'staff'::text])))
  WITH CHECK (clinic_id = current_user_clinic_id());
ALTER POLICY user_profiles_delete_admin ON user_profiles
  USING (current_user_role() = 'admin'::text);
ALTER POLICY fs_deleted_rows_director_only ON form_submissions
  USING ((deleted_at IS NULL) OR (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])));
ALTER POLICY fsal_select_director_admin ON form_submissions_audit_log
  USING (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text]));

-- PART 3 — 6menu 원복
ALTER POLICY daily_closings_staff_unlock_6menu ON daily_closings
  USING ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY daily_room_status_staff_unlock_6menu ON daily_room_status
  USING ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id()))
  WITH CHECK ((current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text])) AND (clinic_id = current_user_clinic_id()));
ALTER POLICY package_payments_staff_unlock_6menu ON package_payments
  USING (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]));
ALTER POLICY packages_staff_unlock_6menu ON packages
  USING (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]));
ALTER POLICY services_staff_unlock_6menu ON services
  USING (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['consultant'::text, 'coordinator'::text, 'therapist'::text]));

-- PART 4 — ③ own-leg 원복
ALTER POLICY user_profiles_read_own ON user_profiles
  USING ((id = auth.uid()) OR (current_user_role() = 'admin'::text));
ALTER POLICY user_profiles_update_own_or_admin ON user_profiles
  USING ((id = auth.uid()) OR (current_user_role() = 'admin'::text))
  WITH CHECK ((id = auth.uid()) OR (current_user_role() = 'admin'::text));
ALTER POLICY user_profiles_insert_admin ON user_profiles
  WITH CHECK ((current_user_role() = 'admin'::text) OR (id = auth.uid()));

-- PART 5 — customer_*_memos 원복
ALTER POLICY manage_update_ccm ON customer_consult_memos
  USING ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])))
  WITH CHECK ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])));
ALTER POLICY manage_update_crm ON customer_reservation_memos
  USING ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])))
  WITH CHECK ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])));
ALTER POLICY manage_update_ctm ON customer_treatment_memos
  USING ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])))
  WITH CHECK ((created_by = (auth.jwt() ->> 'email'::text)) OR (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])));

-- PART 6 — chart_doctor_memos / medical_charts 원복
ALTER POLICY cdm_director_clinic_v2 ON chart_doctor_memos
  USING (((clinic_id = (current_user_clinic_id())::text) AND (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['director'::text, 'admin'::text])))))) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text]))))
  WITH CHECK (((clinic_id = (current_user_clinic_id())::text) AND (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['director'::text, 'admin'::text])))))) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text]))));
ALTER POLICY mc_clinic_isolated_v3 ON medical_charts
  USING ((clinic_id = (current_user_clinic_id())::text) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text, 'manager'::text, 'coordinator'::text]))))
  WITH CHECK ((clinic_id = (current_user_clinic_id())::text) OR ((current_user_clinic_id() IS NULL) AND (current_user_role() = ANY (ARRAY['admin'::text, 'director'::text, 'manager'::text, 'coordinator'::text]))));
ALTER POLICY mc_deleted_rows_director_only ON medical_charts
  USING ((is_deleted = false) OR (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])));

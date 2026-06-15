-- ROLLBACK: 20260615160000_rls_clinic_isolation_patient_tables.sql
-- 2026-06-15 prod pg_policies 실재 정책으로 원복(DROP+CREATE). 환자 데이터 무손실.
-- rrn_decrypt 는 게이트 이전 본문(전 authenticated 복호화)으로 원복.

BEGIN;

-- ── customers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_admin_all" ON customers;
CREATE POLICY "customers_admin_all" ON customers FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

DROP POLICY IF EXISTS "customers_coord_insert" ON customers;
CREATE POLICY "customers_coord_insert" ON customers FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above() OR is_consultant_or_above());

DROP POLICY IF EXISTS "customers_approved_read" ON customers;
CREATE POLICY "customers_approved_read" ON customers FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS "customers_staff_select" ON customers;
CREATE POLICY "customers_staff_select" ON customers FOR SELECT TO authenticated
  USING (is_floor_staff());

DROP POLICY IF EXISTS "customers_consult_update" ON customers;
CREATE POLICY "customers_consult_update" ON customers FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());

DROP POLICY IF EXISTS "customers_coord_update" ON customers;
CREATE POLICY "customers_coord_update" ON customers FOR UPDATE TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());

DROP POLICY IF EXISTS "customers_staff_update" ON customers;
CREATE POLICY "customers_staff_update" ON customers FOR UPDATE TO authenticated
  USING (is_floor_staff()) WITH CHECK (is_floor_staff());

-- ── check_ins ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "check_ins_admin_all" ON check_ins;
CREATE POLICY "check_ins_admin_all" ON check_ins FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

DROP POLICY IF EXISTS "check_ins_delete_admin" ON check_ins;
CREATE POLICY "check_ins_delete_admin" ON check_ins FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager());

DROP POLICY IF EXISTS "check_ins_consult_insert" ON check_ins;
CREATE POLICY "check_ins_consult_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());

DROP POLICY IF EXISTS "check_ins_coord_insert" ON check_ins;
CREATE POLICY "check_ins_coord_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());

DROP POLICY IF EXISTS "check_ins_insert" ON check_ins;
CREATE POLICY "check_ins_insert" ON check_ins FOR INSERT TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));

DROP POLICY IF EXISTS "check_ins_approved_read" ON check_ins;
CREATE POLICY "check_ins_approved_read" ON check_ins FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS "check_ins_read" ON check_ins;
CREATE POLICY "check_ins_read" ON check_ins FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "check_ins_consult_update" ON check_ins;
CREATE POLICY "check_ins_consult_update" ON check_ins FOR UPDATE TO authenticated
  USING      (is_consultant_or_above() AND ((consultant_id IS NULL) OR (consultant_id = current_staff_id()) OR is_admin_or_manager()))
  WITH CHECK (is_consultant_or_above() AND ((consultant_id IS NULL) OR (consultant_id = current_staff_id()) OR is_admin_or_manager()));

DROP POLICY IF EXISTS "check_ins_coord_update" ON check_ins;
CREATE POLICY "check_ins_coord_update" ON check_ins FOR UPDATE TO authenticated
  USING      (is_coordinator_or_above() AND (status = ANY (ARRAY['registered'::text, 'checklist'::text, 'exam_waiting'::text])))
  WITH CHECK (is_coordinator_or_above() AND (status = ANY (ARRAY['registered'::text, 'checklist'::text, 'exam_waiting'::text, 'consult_waiting'::text, 'cancelled'::text])));

DROP POLICY IF EXISTS "check_ins_flag_update" ON check_ins;
CREATE POLICY "check_ins_flag_update" ON check_ins FOR UPDATE TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());

DROP POLICY IF EXISTS "check_ins_therap_update" ON check_ins;
CREATE POLICY "check_ins_therap_update" ON check_ins FOR UPDATE TO authenticated
  USING      (is_therapist_or_technician() AND ((therapist_id = current_staff_id()) OR (technician_id = current_staff_id()) OR is_admin_or_manager()))
  WITH CHECK (is_therapist_or_technician() AND ((therapist_id = current_staff_id()) OR (technician_id = current_staff_id()) OR is_admin_or_manager()));

DROP POLICY IF EXISTS "check_ins_update_privileged" ON check_ins;
CREATE POLICY "check_ins_update_privileged" ON check_ins FOR UPDATE TO authenticated
  USING      (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));

DROP POLICY IF EXISTS "check_ins_update_therapist_own" ON check_ins;
CREATE POLICY "check_ins_update_therapist_own" ON check_ins FOR UPDATE TO authenticated
  USING      ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()))
  WITH CHECK ((current_user_role() = 'therapist'::text) AND (therapist_id = current_user_staff_id()));

-- ── reservations ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reservations_admin_all" ON reservations;
CREATE POLICY "reservations_admin_all" ON reservations FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

DROP POLICY IF EXISTS "reservations_coord_all" ON reservations;
CREATE POLICY "reservations_coord_all" ON reservations FOR ALL TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());

DROP POLICY IF EXISTS "reservations_approved_read" ON reservations;
CREATE POLICY "reservations_approved_read" ON reservations FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS "reservations_consult_update" ON reservations;
CREATE POLICY "reservations_consult_update" ON reservations FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());

DROP POLICY IF EXISTS "reservations_staff_update" ON reservations;
CREATE POLICY "reservations_staff_update" ON reservations FOR UPDATE TO authenticated
  USING (is_approved_user()) WITH CHECK (is_approved_user());

-- ── payments ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_admin_all" ON payments;
CREATE POLICY "payments_admin_all" ON payments FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

DROP POLICY IF EXISTS "payments_delete_admin" ON payments;
CREATE POLICY "payments_delete_admin" ON payments FOR DELETE TO authenticated
  USING (current_user_is_admin_or_manager());

DROP POLICY IF EXISTS "payments_consult_insert" ON payments;
CREATE POLICY "payments_consult_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above() AND (payment_type = 'payment'::text));

DROP POLICY IF EXISTS "payments_coord_insert" ON payments;
CREATE POLICY "payments_coord_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above() AND (payment_type = 'payment'::text));

DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));

DROP POLICY IF EXISTS "payments_therap_insert" ON payments;
CREATE POLICY "payments_therap_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (is_therapist_or_technician() AND (payment_type = 'payment'::text));

DROP POLICY IF EXISTS "payments_approved_read" ON payments;
CREATE POLICY "payments_approved_read" ON payments FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS "payments_read" ON payments;
CREATE POLICY "payments_read" ON payments FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated
  USING      (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'consultant'::text, 'coordinator'::text]));

-- ── rrn_decrypt 게이트 이전 본문 원복 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enc   BYTEA;
  v_key   TEXT;
  v_plain TEXT;
BEGIN
  SELECT rrn_enc INTO v_enc
    FROM public.customers
   WHERE id = customer_uuid;

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);
  RETURN v_plain;
END;
$function$;

COMMIT;

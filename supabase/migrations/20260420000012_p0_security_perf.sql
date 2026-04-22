-- foot-029: Replace auth_all USING(true) with is_approved_user() on clinic-scoped tables
DO $$ BEGIN
  -- consent_templates
  DROP POLICY IF EXISTS auth_all ON consent_templates;
  CREATE POLICY approved_all ON consent_templates FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());

  -- payment_code_claims
  DROP POLICY IF EXISTS auth_all ON payment_code_claims;
  CREATE POLICY approved_all ON payment_code_claims FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());

  -- insurance_receipts
  DROP POLICY IF EXISTS auth_all ON insurance_receipts;
  CREATE POLICY approved_all ON insurance_receipts FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());

  -- prescriptions
  DROP POLICY IF EXISTS auth_all ON prescriptions;
  CREATE POLICY approved_all ON prescriptions FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());

  -- medications
  DROP POLICY IF EXISTS auth_all ON medications;
  CREATE POLICY approved_all ON medications FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());

  -- prescription_items (no clinic_id, but linked to prescriptions; still tighten)
  DROP POLICY IF EXISTS auth_all ON prescription_items;
  CREATE POLICY approved_all ON prescription_items FOR ALL TO authenticated
    USING (is_approved_user()) WITH CHECK (is_approved_user());
END $$;

-- foot-023: completed_at trigger — auto-set when status → done
CREATE OR REPLACE FUNCTION set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := NOW();
  END IF;
  IF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_completed_at ON check_ins;
CREATE TRIGGER trg_set_completed_at
  BEFORE UPDATE ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION set_completed_at();

-- foot-035: Missing indexes
CREATE INDEX IF NOT EXISTS idx_status_transitions_clinic_date
  ON status_transitions (clinic_id, transitioned_at DESC);

CREATE INDEX IF NOT EXISTS idx_status_transitions_check_in
  ON status_transitions (check_in_id);

CREATE INDEX IF NOT EXISTS idx_reservations_clinic_date
  ON reservations (clinic_id, reservation_date);

CREATE INDEX IF NOT EXISTS idx_packages_clinic_status
  ON packages (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_customers_clinic_phone
  ON customers (clinic_id, phone);

CREATE INDEX IF NOT EXISTS idx_room_assignments_clinic_date
  ON room_assignments (clinic_id, date);

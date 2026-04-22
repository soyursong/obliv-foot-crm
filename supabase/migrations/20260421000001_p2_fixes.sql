-- foot-024: queue_number unique per clinic+date
CREATE OR REPLACE FUNCTION kst_date(ts TIMESTAMPTZ)
RETURNS DATE AS $$
  SELECT (ts AT TIME ZONE 'Asia/Seoul')::DATE;
$$ LANGUAGE sql IMMUTABLE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_clinic_date_queue
  ON check_ins (clinic_id, kst_date(checked_in_at), queue_number)
  WHERE queue_number IS NOT NULL;

-- foot-036: updated_at auto-refresh trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'customers', 'reservations', 'packages', 'check_ins',
    'rooms', 'staff', 'daily_closings', 'consent_templates'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I; CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- foot-022: Block check-in from noshow/cancelled reservations (DB constraint)
CREATE OR REPLACE FUNCTION check_reservation_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE id = NEW.reservation_id
        AND status IN ('noshow', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot create check-in for noshow/cancelled reservation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_reservation_status ON check_ins;
CREATE TRIGGER trg_check_reservation_status
  BEFORE INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION check_reservation_status();

-- foot-027: Atomic consultant assignment
CREATE OR REPLACE FUNCTION assign_consultant_atomic(
  p_clinic_id UUID,
  p_date TEXT,
  p_max_concurrent INT DEFAULT 3
) RETURNS UUID AS $$
DECLARE
  v_best_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('assign_consultant_' || p_clinic_id::TEXT || p_date));

  SELECT ra.staff_id INTO v_best_id
  FROM room_assignments ra
  WHERE ra.clinic_id = p_clinic_id
    AND ra.date = p_date::DATE
    AND ra.room_type = 'consultation'
    AND ra.staff_id IS NOT NULL
  ORDER BY (
    SELECT COUNT(*) FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id = ra.staff_id
      AND ci.status IN ('consult_waiting', 'consultation')
      AND ci.checked_in_at::DATE = p_date::DATE
  ) ASC
  LIMIT 1;

  RETURN v_best_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rollback: T-20260514-foot-CHECKIN-AUTO-STAGE batch_checkin
-- status='registered' 하드코딩으로 복원

CREATE OR REPLACE FUNCTION batch_checkin(
  p_clinic_id UUID,
  p_reservations JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res JSONB;
  v_qn INT;
  v_success INT := 0;
  v_skipped INT := 0;
  v_date TEXT;
BEGIN
  FOR v_res IN SELECT * FROM jsonb_array_elements(p_reservations)
  LOOP
    v_date := v_res->>'reservation_date';

    -- Skip if already checked in
    IF EXISTS (SELECT 1 FROM check_ins WHERE reservation_id = (v_res->>'id')::UUID) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Atomic queue number
    PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::TEXT || v_date));
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_qn
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND checked_in_at::DATE = v_date::DATE;

    INSERT INTO check_ins (
      clinic_id, customer_id, reservation_id, customer_name, customer_phone,
      visit_type, status, queue_number
    ) VALUES (
      p_clinic_id,
      (v_res->>'customer_id')::UUID,
      (v_res->>'id')::UUID,
      v_res->>'customer_name',
      v_res->>'customer_phone',
      v_res->>'visit_type',
      'registered',
      v_qn
    );

    UPDATE reservations SET status = 'checked_in' WHERE id = (v_res->>'id')::UUID;
    v_success := v_success + 1;
  END LOOP;

  RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

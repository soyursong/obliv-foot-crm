-- Replace next_queue_number with atomic version using advisory lock
CREATE OR REPLACE FUNCTION next_queue_number(p_clinic_id UUID, p_date DATE DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date DATE;
  v_next INTEGER;
BEGIN
  v_date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Seoul')::date);
  -- Advisory lock keyed on clinic_id hash + date to serialize queue number generation
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_date::text));
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next
  FROM check_ins
  WHERE clinic_id = p_clinic_id
    AND checked_in_at::date = v_date;
  RETURN v_next;
END;
$$;

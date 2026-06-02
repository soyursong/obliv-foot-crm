-- ROLLBACK: T-20260602-foot-TZ-AUDIT-FIX (RPC 일일경계 KST 통일 되돌리기)
--   kst_date(checked_in_at) → checked_in_at::date (이전 활성 정의 복원).
--   ⚠ 복원 시 KST 오전 체크인 일일경계 오집계 버그가 재현됨(의도적, 긴급 회귀 대비용).
--   적용: node scripts/apply_20260602250000_tz_checkin_kst_unify.mjs --rollback
--   author: dev-foot / 2026-06-02

BEGIN;

-- 1) next_queue_number 복원 (20260420000011)
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
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_date::text));
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next
  FROM check_ins
  WHERE clinic_id = p_clinic_id
    AND checked_in_at::date = v_date;
  RETURN v_next;
END;
$$;

-- 2) batch_checkin 복원 (20260517000011)
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
  v_visit_type TEXT;
  v_auto_status TEXT;
BEGIN
  FOR v_res IN SELECT * FROM jsonb_array_elements(p_reservations)
  LOOP
    v_date := v_res->>'reservation_date';
    v_visit_type := COALESCE(v_res->>'visit_type', 'new');
    IF v_visit_type = 'returning' THEN
      v_auto_status := 'treatment_waiting';
    ELSE
      v_auto_status := 'consult_waiting';
    END IF;
    IF EXISTS (SELECT 1 FROM check_ins WHERE reservation_id = (v_res->>'id')::UUID) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
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
      v_visit_type,
      v_auto_status,
      v_qn
    );
    UPDATE reservations SET status = 'checked_in' WHERE id = (v_res->>'id')::UUID;
    v_success := v_success + 1;
  END LOOP;
  RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) assign_consultant_atomic 복원 (20260421000001)
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

-- 4) self_checkin_with_reservation_link — queue 발번만 checked_in_at::date 로 환원
--    (전체 본문 재정의는 20260602210000 원본과 동일, 159행만 환원)
CREATE OR REPLACE FUNCTION public.self_checkin_with_reservation_link(
  p_clinic_id        UUID,
  p_customer_payload JSONB,
  p_today            DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today           DATE    := COALESCE(p_today, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_name            TEXT    := NULLIF(trim(p_customer_payload->>'name'), '');
  v_phone           TEXT    := NULLIF(p_customer_payload->>'phone', '');
  v_phone_e164      TEXT    := NULLIF(p_customer_payload->>'phone_e164', '');
  v_phone_digits    TEXT    := NULLIF(regexp_replace(COALESCE(p_customer_payload->>'phone',''), '[^0-9]', '', 'g'), '');
  v_visit_type      TEXT    := COALESCE(NULLIF(p_customer_payload->>'visit_type', ''), 'new');
  v_sms_opt_in      BOOLEAN := COALESCE((p_customer_payload->>'sms_opt_in')::boolean, true);
  v_birth_date      DATE    := NULLIF(p_customer_payload->>'birth_date', '')::date;
  v_address         TEXT    := NULLIF(p_customer_payload->>'address', '');
  v_privacy_consent BOOLEAN := NULLIF(p_customer_payload->>'privacy_consent', '')::boolean;
  v_notes           JSONB   := p_customer_payload->'notes';
  v_customer_id     UUID    := NULLIF(p_customer_payload->>'customer_id', '')::uuid;
  v_reservation_id  UUID    := NULLIF(p_customer_payload->>'reservation_id', '')::uuid;
  v_ci_status       TEXT;
  v_queue           INTEGER;
  v_check_in_id     UUID;
  v_existing_id     UUID;
  v_existing_queue  INTEGER;
  v_resv_linked     BOOLEAN := false;
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_CLINIC');
  END IF;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_NAME');
  END IF;

  v_ci_status := COALESCE(
    NULLIF(p_customer_payload->>'ci_status', ''),
    CASE WHEN v_visit_type = 'returning' THEN 'treatment_waiting' ELSE 'consult_waiting' END
  );

  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || v_today::text));

  IF v_customer_id IS NULL THEN
    SELECT id INTO v_customer_id
      FROM customers
     WHERE clinic_id = p_clinic_id
       AND (
         (v_phone IS NOT NULL AND phone = v_phone)
         OR (v_phone_digits IS NOT NULL AND length(v_phone_digits) >= 10
             AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_phone_digits)
       )
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO customers (clinic_id, name, phone, visit_type, sms_opt_in, birth_date, address, privacy_consent)
      VALUES (
        p_clinic_id, v_name, COALESCE(v_phone, v_phone_e164),
        CASE WHEN v_visit_type = 'returning' THEN 'returning' ELSE 'new' END,
        v_sms_opt_in, v_birth_date, v_address, COALESCE(v_privacy_consent, false)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      UPDATE customers SET sms_opt_in = v_sms_opt_in WHERE id = v_customer_id;
    END IF;
  END IF;

  IF v_reservation_id IS NULL AND v_customer_id IS NOT NULL THEN
    SELECT id INTO v_reservation_id
      FROM reservations
     WHERE clinic_id = p_clinic_id
       AND customer_id = v_customer_id
       AND reservation_date = v_today
       AND status = 'confirmed'
     ORDER BY reservation_time ASC
     LIMIT 1;
  END IF;

  SELECT id, queue_number INTO v_existing_id, v_existing_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND status <> 'cancelled'
     AND (created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
     AND (
       (v_reservation_id IS NOT NULL AND reservation_id = v_reservation_id)
       OR (v_customer_id IS NOT NULL AND customer_id = v_customer_id)
     )
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'already_checked_in', true,
      'check_in_id', v_existing_id, 'queue_number', v_existing_queue,
      'reservation_id', v_reservation_id,
      'reservation_linked', (v_reservation_id IS NOT NULL),
      'customer_id', v_customer_id
    );
  END IF;

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue
    FROM check_ins
   WHERE clinic_id = p_clinic_id
     AND checked_in_at::date = v_today;

  BEGIN
    INSERT INTO check_ins (
      clinic_id, customer_id, customer_name, customer_phone,
      visit_type, status, queue_number, notes, reservation_id
    ) VALUES (
      p_clinic_id, v_customer_id, v_name, v_phone,
      v_visit_type, v_ci_status, v_queue, v_notes, v_reservation_id
    )
    RETURNING id INTO v_check_in_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'duplicate', true,
                              'error_code', 'DUPLICATE_CHECKIN_TODAY');
  END;

  IF v_reservation_id IS NOT NULL THEN
    UPDATE reservations
       SET status = 'checked_in', updated_at = now()
     WHERE id = v_reservation_id AND status = 'confirmed';
    v_resv_linked := true;
  END IF;

  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (v_check_in_id, p_clinic_id, 'registered', v_ci_status, 'self_checkin');

  RETURN jsonb_build_object(
    'success', true,
    'check_in_id', v_check_in_id,
    'queue_number', v_queue,
    'customer_id', v_customer_id,
    'reservation_id', v_reservation_id,
    'reservation_linked', COALESCE(v_resv_linked, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_checkin_with_reservation_link(UUID, JSONB, DATE)
  TO anon, authenticated;

COMMIT;

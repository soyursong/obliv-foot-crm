-- T-20260514-foot-CHECKIN-AUTO-STAGE: batch_checkin RPC 자동 스테이지 세팅
--
-- Root Cause:
--   기존 batch_checkin RPC (20260420000013)가 visit_type과 무관하게 status='registered' 하드코딩.
--   일괄 배치 체크인 시에도 초진→상담대기, 재진→치료대기로 자동 세팅해야 함.
--
-- Fix:
--   visit_type에 따라 status 자동 분기:
--   - 'returning' → 'treatment_waiting'
--   - 'new' | 'experience' | 기타 → 'consult_waiting'
--
-- Rollback: 20260517000011_batch_checkin_auto_stage.down.sql

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

    -- AC-1/AC-2: 초진·체험 → 상담대기, 재진 → 치료대기 자동 세팅
    IF v_visit_type = 'returning' THEN
      v_auto_status := 'treatment_waiting';
    ELSE
      v_auto_status := 'consult_waiting';
    END IF;

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

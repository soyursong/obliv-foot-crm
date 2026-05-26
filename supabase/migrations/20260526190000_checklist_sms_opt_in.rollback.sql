-- ============================================================
-- ROLLBACK: T-20260525-foot-MESSAGING-V1 AC-15
-- fn_complete_prescreen_checklist sms_opt_in 처리 제거
-- 대상 마이그: 20260526190000_checklist_sms_opt_in.sql
-- ============================================================

BEGIN;

-- 원본 fn_complete_prescreen_checklist 복원 (sms_opt_in 처리 없는 버전)
CREATE OR REPLACE FUNCTION fn_complete_prescreen_checklist(
  p_check_in_id    UUID,
  p_checklist_data JSONB,
  p_storage_path   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row          RECORD;
  v_checklist_id UUID;
BEGIN
  SELECT id, status, clinic_id, customer_id
  INTO v_row
  FROM check_ins
  WHERE id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status);
  END IF;

  INSERT INTO checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;

  UPDATE check_ins SET status = 'exam_waiting' WHERE id = p_check_in_id;

  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

  RETURN jsonb_build_object('success', true, 'checklist_id', v_checklist_id);
END;
$$;

ALTER  FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) TO anon;

COMMIT;

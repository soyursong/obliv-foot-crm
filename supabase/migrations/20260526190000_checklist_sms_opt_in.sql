-- ============================================================
-- T-20260525-foot-MESSAGING-V1 AC-15
-- fn_complete_prescreen_checklist — sms_opt_in 처리 추가
-- 셀프체크인에서 agree_marketing=false 제출 시
--   customers.sms_opt_in = FALSE 로 업데이트
-- ============================================================
-- 롤백: 20260526190000_checklist_sms_opt_in.rollback.sql
-- 작성: dev-foot / 2026-05-26
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_complete_prescreen_checklist(
  p_check_in_id    UUID,
  p_checklist_data JSONB,
  p_storage_path   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row          RECORD;
  v_checklist_id UUID;
  v_agree_mkt    BOOLEAN;
BEGIN
  -- check_in 조회
  SELECT id, status, clinic_id, customer_id
  INTO v_row
  FROM check_ins
  WHERE id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 이미 완료된 경우 재제출 차단
  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status);
  END IF;

  -- 1) checklists INSERT
  INSERT INTO checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;

  -- 2) check_ins.status → exam_waiting
  UPDATE check_ins
  SET status = 'exam_waiting'
  WHERE id = p_check_in_id;

  -- 3) status_transitions
  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

  -- 4) T-20260525-foot-MESSAGING-V1 AC-15:
  --    agree_marketing=false → customers.sms_opt_in = FALSE
  --    agree_marketing=true or absent → 기존 값 유지 (기본 TRUE)
  v_agree_mkt := (p_checklist_data->>'agree_marketing')::BOOLEAN;
  IF v_agree_mkt = FALSE THEN
    UPDATE customers
    SET sms_opt_in = FALSE
    WHERE id = v_row.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'checklist_id', v_checklist_id
  );
END;
$$;

ALTER  FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION fn_complete_prescreen_checklist(UUID, JSONB, TEXT) TO anon;

COMMENT ON FUNCTION fn_complete_prescreen_checklist IS
  'T-20260525-foot-MESSAGING-V1 AC-15: sms_opt_in 처리 추가. agree_marketing=false 시 customers.sms_opt_in=FALSE 업데이트';

COMMIT;

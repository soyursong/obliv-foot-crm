-- ROLLBACK: T-20260710-foot-PRESCREEN-SEARCHPATH-PIN-HARDEN
-- 20260710224000_prescreen_searchpath_pin_harden.sql 원복 (긴급 회복 전용).
--
-- ⚠ 적용 시 두 SECDEF 함수의 search_path 핀이 제거된다 = §1-8 guardrail 미충족 상태(하이재킹 표면 재개방).
--   핀+qualify 로 인해 공개흐름(TabletChecklistPage anon) 이 파손됐고 즉시 원복이 유일 회복책일 때만.
--
-- 방식: 핀 이전 권위 정본을 CREATE OR REPLACE 로 복원.
--   · fn_prescreen_start            → 20260506000030_checklists_table.sql 본문(무핀, unqualified)
--   · fn_complete_prescreen_checklist → 20260526190000_checklist_sms_opt_in.sql 본문(무핀, unqualified, sms_opt_in 포함)
--   SET search_path 절 없음 = proconfig NULL(무핀) 로 원복. 로직 무변경.
--
-- 멱등: CREATE OR REPLACE + GRANT 반복 무해. 데이터 무변경.

BEGIN;

-- ── A3) fn_prescreen_start 무핀 원복 (20260506000030 정본) ──
CREATE OR REPLACE FUNCTION public.fn_prescreen_start(p_check_in_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row  RECORD;
  v_cust RECORD;
BEGIN
  SELECT ci.id, ci.status, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone, ci.visit_type
  INTO v_row
  FROM check_ins ci
  WHERE ci.id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_row.status = 'registered' THEN
    UPDATE check_ins SET status = 'checklist' WHERE id = p_check_in_id;

    INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
    VALUES (p_check_in_id, v_row.clinic_id, 'registered', 'checklist', 'tablet_anon');
  END IF;

  IF v_row.customer_id IS NOT NULL THEN
    SELECT name, phone, birth_date, chart_number
    INTO v_cust
    FROM customers
    WHERE id = v_row.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'status',         CASE WHEN v_row.status = 'registered' THEN 'checklist' ELSE v_row.status END,
    'customer_name',  v_row.customer_name,
    'customer_phone', v_row.customer_phone,
    'customer_id',    v_row.customer_id,
    'clinic_id',      v_row.clinic_id,
    'visit_type',     v_row.visit_type,
    'birth_date',     COALESCE(v_cust.birth_date, NULL),
    'chart_number',   COALESCE(v_cust.chart_number, NULL)
  );
END;
$$;

ALTER  FUNCTION public.fn_prescreen_start(UUID) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION public.fn_prescreen_start(UUID) TO anon;

-- ── A4) fn_complete_prescreen_checklist 무핀 원복 (20260526190000 정본, sms_opt_in 포함) ──
CREATE OR REPLACE FUNCTION public.fn_complete_prescreen_checklist(
  p_check_in_id    UUID,
  p_checklist_data JSONB,
  p_storage_path   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row          RECORD;
  v_checklist_id UUID;
  v_agree_mkt    BOOLEAN;
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

  UPDATE check_ins
  SET status = 'exam_waiting'
  WHERE id = p_check_in_id;

  INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

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

ALTER  FUNCTION public.fn_complete_prescreen_checklist(UUID, JSONB, TEXT) OWNER TO postgres;
GRANT  EXECUTE ON FUNCTION public.fn_complete_prescreen_checklist(UUID, JSONB, TEXT) TO anon;

COMMIT;

-- 검증 (rollback 후): proconfig = NULL(무핀) 기대
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('fn_prescreen_start','fn_complete_prescreen_checklist');

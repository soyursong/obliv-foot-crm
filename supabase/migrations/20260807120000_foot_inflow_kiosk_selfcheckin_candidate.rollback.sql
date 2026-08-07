-- ROLLBACK — T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE (되돌림)
-- 2026-08-07 12:00 KST
-- ⚠ forward-only 원칙상 통상 롤백 불필요(신규 nullable 컬럼·candidate write 는 canonical/하류 무영향).
--    긴급 원복 시에만 사용. 컬럼 DROP은 candidate 데이터 유실 — 값이 이미 쌓였으면 신중.
-- =====================================================

-- Step 2 원복: fn_complete_prescreen_checklist 를 candidate write 이전(20260710224000 PIN-HARDEN 정본)으로 복원.
CREATE OR REPLACE FUNCTION public.fn_complete_prescreen_checklist(
  p_check_in_id    UUID,
  p_checklist_data JSONB,
  p_storage_path   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row          RECORD;
  v_checklist_id UUID;
  v_agree_mkt    BOOLEAN;
BEGIN
  SELECT id, status, clinic_id, customer_id
  INTO v_row
  FROM public.check_ins
  WHERE id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status);
  END IF;

  INSERT INTO public.checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;

  UPDATE public.check_ins
  SET status = 'exam_waiting'
  WHERE id = p_check_in_id;

  INSERT INTO public.status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

  v_agree_mkt := (p_checklist_data->>'agree_marketing')::BOOLEAN;
  IF v_agree_mkt = FALSE THEN
    UPDATE public.customers
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

-- Step 1 원복: candidate 컬럼 제거 (candidate 값 유실 주의 — forward-only라 통상 유지 권장)
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS inflow_channel_self_reported;

-- ⚠ Step 0(checklists.storage_path / started_at)은 롤백하지 않는다(의도적 비대칭).
--   근거: 이 2컬럼은 본 티켓 feature 가 아니라 선언정본 20260506000030 이 declared 했으나 prod 로
--   드리프트한 원장 정합 복원(Ledger Reconciliation). storage_path 는 LIVE 함수(Step 2 복원본 포함)와
--   FE(p_storage_path)가 참조하는 살아있는 컬럼 → DROP 하면 함수 INSERT 가 다시 42703 로 깨진다.
--   따라서 rollback 후에도 storage_path/started_at 는 존치(forward-doc 재수렴 불변).
--   ALTER TABLE public.checklists DROP COLUMN storage_path;  -- ← 절대 실행 금지

NOTIFY pgrst, 'reload schema';

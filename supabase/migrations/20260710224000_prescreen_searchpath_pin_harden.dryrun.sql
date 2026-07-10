-- ============================================================================
-- T-20260710-foot-PRESCREEN-SEARCHPATH-PIN-HARDEN — DRY-RUN (BEGIN..ROLLBACK 셰도)
-- foot prod: rxlomoozakkjesdqjtvd — 실 apply 없이 트랜잭션 내 재현 후 ROLLBACK.
--
-- 목적: up.sql 의 CREATE OR REPLACE(핀 + public. qualify)를 트랜잭션으로 재현하되,
--       (1) 핀 적용됨(proconfig={search_path=""}) (2) SECDEF 유지 (3) anon EXECUTE 유지
--       (4) 핀 상태에서 함수가 정상 resolve/실행되는지(unqualified 잔존 없음) 를 검증한 뒤
--       ROLLBACK 으로 원상 복귀 → prod 무변경 확인.
--
-- 실행: psql "$FOOT_PROD_URL" -f 20260710224000_prescreen_searchpath_pin_harden.dryrun.sql
--       (본 파일은 말미 ROLLBACK 으로 종료 → apply 되지 않음)
-- ============================================================================

BEGIN;

-- ── 사전 상태 스냅샷 (핀 전: 기대 proconfig = NULL) ──
DO $pre$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('fn_prescreen_start','fn_complete_prescreen_checklist')
  LOOP
    RAISE NOTICE '[PRE] % proconfig=%', r.proname, r.proconfig;
  END LOOP;
END;
$pre$;

-- ── up.sql 본체 재현: 핀 + qualify ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prescreen_start(p_check_in_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row RECORD; v_cust RECORD;
BEGIN
  SELECT ci.id, ci.status, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone, ci.visit_type
  INTO v_row FROM public.check_ins ci WHERE ci.id = p_check_in_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found'); END IF;
  IF v_row.status = 'registered' THEN
    UPDATE public.check_ins SET status = 'checklist' WHERE id = p_check_in_id;
    INSERT INTO public.status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
    VALUES (p_check_in_id, v_row.clinic_id, 'registered', 'checklist', 'tablet_anon');
  END IF;
  IF v_row.customer_id IS NOT NULL THEN
    SELECT name, phone, birth_date, chart_number INTO v_cust FROM public.customers WHERE id = v_row.customer_id;
  END IF;
  RETURN jsonb_build_object('success', true,
    'status', CASE WHEN v_row.status='registered' THEN 'checklist' ELSE v_row.status END,
    'customer_name', v_row.customer_name, 'customer_phone', v_row.customer_phone,
    'customer_id', v_row.customer_id, 'clinic_id', v_row.clinic_id, 'visit_type', v_row.visit_type,
    'birth_date', COALESCE(v_cust.birth_date, NULL), 'chart_number', COALESCE(v_cust.chart_number, NULL));
END; $$;
ALTER FUNCTION public.fn_prescreen_start(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.fn_prescreen_start(UUID) TO anon;

CREATE OR REPLACE FUNCTION public.fn_complete_prescreen_checklist(
  p_check_in_id UUID, p_checklist_data JSONB, p_storage_path TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row RECORD; v_checklist_id UUID; v_agree_mkt BOOLEAN;
BEGIN
  SELECT id, status, clinic_id, customer_id INTO v_row FROM public.check_ins WHERE id = p_check_in_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found'); END IF;
  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status); END IF;
  INSERT INTO public.checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;
  UPDATE public.check_ins SET status = 'exam_waiting' WHERE id = p_check_in_id;
  INSERT INTO public.status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');
  v_agree_mkt := (p_checklist_data->>'agree_marketing')::BOOLEAN;
  IF v_agree_mkt = FALSE THEN UPDATE public.customers SET sms_opt_in = FALSE WHERE id = v_row.customer_id; END IF;
  RETURN jsonb_build_object('success', true, 'checklist_id', v_checklist_id);
END; $$;
ALTER FUNCTION public.fn_complete_prescreen_checklist(UUID, JSONB, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.fn_complete_prescreen_checklist(UUID, JSONB, TEXT) TO anon;

-- ── 사후 검증 (핀 후: 기대 proconfig={search_path=""}, prosecdef=t, anon EXECUTE=t) ──
DO $post$
DECLARE r RECORD; v_fail bool := false;
BEGIN
  FOR r IN
    SELECT p.proname, p.proconfig, p.prosecdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('fn_prescreen_start','fn_complete_prescreen_checklist')
  LOOP
    RAISE NOTICE '[POST] % proconfig=% secdef=% anon_exec=%', r.proname, r.proconfig, r.prosecdef, r.anon_exec;
    IF r.proconfig IS NULL OR NOT (r.proconfig @> ARRAY['search_path='])       THEN v_fail := true; RAISE WARNING 'FAIL: % search_path 미핀', r.proname; END IF;
    IF NOT r.prosecdef  THEN v_fail := true; RAISE WARNING 'FAIL: % SECDEF 소실', r.proname; END IF;
    IF NOT r.anon_exec  THEN v_fail := true; RAISE WARNING 'FAIL: % anon EXECUTE 소실', r.proname; END IF;
  END LOOP;
  IF v_fail THEN RAISE EXCEPTION 'DRYRUN 검증 실패 — 위 WARNING 확인'; END IF;
  RAISE NOTICE '[DRYRUN] 검증 통과: 핀 O / SECDEF O / anon EXECUTE O';
END;
$post$;

-- 무변경 원복
ROLLBACK;

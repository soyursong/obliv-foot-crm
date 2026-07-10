-- T-20260710-foot-PRESCREEN-SEARCHPATH-PIN-HARDEN
-- 부모 T-20260710-foot-SECDEF-ANON-REVOKE 잔여 #2 분해.
-- 계약 §1-8 canonical guardrail: SECURITY DEFINER 함수는 SET search_path='' 의무.
-- §16-3c: SECURITY DEFINER = owner(postgres) 권한 스위치 → 무핀 시 search_path 하이재킹으로
--         owner 권한 탈취 표면. 화이트리스트 유지 2함수(공개흐름 필수)를 guardrail 하드닝.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 대상 2함수 (foot prod rxlomoozakkjesdqjtvd, anon EXECUTE 화이트리스트 유지분)
--   A3 fn_prescreen_start(uuid)                          — TabletChecklistPage(anonClient) 공개흐름
--   A4 fn_complete_prescreen_checklist(uuid,jsonb,text)  — TabletChecklistPage(anonClient) 공개흐름
-- 둘 다 SECDEF 이나 search_path 무핀(부모 관측 A3/A4 ⚠) → 본 마이그로 핀.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ AC1 핵심: 핀(SET search_path='') + 본문 스키마-qualify 동시 적용
-- ══════════════════════════════════════════════════════════════════════════════
-- 두 함수 본문은 unqualified 테이블참조(check_ins/customers/status_transitions/checklists)를
-- 포함한다. search_path='' 로 핀하면 이 참조들이 resolve 실패(ERROR: relation does not exist).
-- → 핀과 동시에 모든 테이블참조를 public. 로 스키마-qualify 한다(CREATE OR REPLACE 로 원자 적용).
--   · 내장함수(now, jsonb_build_object, gen_random_uuid, 캐스트 등)는 pg_catalog 소속 →
--     search_path='' 여도 pg_catalog 는 항상 암묵 우선 resolve → qualify 불요.
--   · 테이블(public 스키마)만 명시 qualify 필요.
--
-- 본문 로직은 무변경(권위 정본 승계):
--   · fn_prescreen_start           : 20260506000030_checklists_table.sql
--   · fn_complete_prescreen_checklist: 20260526190000_checklist_sms_opt_in.sql (sms_opt_in AC-15 포함)
--   → 로직 동일, 유일 차이 = SET search_path='' + public. qualify.
--
-- 멱등: CREATE OR REPLACE + GRANT 반복 무해. 스키마/데이터 무변경(함수 proconfig/본문만).
-- 가역: rollback SQL = search_path 핀 제거(무핀 본문 복원). 20260710224000_..._pin_harden.rollback.sql
-- CREATE OR REPLACE 는 기존 ACL(anon EXECUTE) 보존 — 안전차 GRANT 재부여도 명시(멱등).
-- 적용: 대표 게이트 면제(ADDITIVE 속성 하드닝·가역·스키마 무변경) → supervisor DB-GATE
--       (proconfig search_path 핀 전/후 대조 + staging E2E TabletChecklistPage anon 흐름 회귀 0).

BEGIN;

-- ── A3) fn_prescreen_start — search_path 핀 + public. qualify ──
CREATE OR REPLACE FUNCTION public.fn_prescreen_start(p_check_in_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row  RECORD;
  v_cust RECORD;
BEGIN
  -- check_in 로드
  SELECT ci.id, ci.status, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone, ci.visit_type
  INTO v_row
  FROM public.check_ins ci
  WHERE ci.id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- registered → checklist 전이
  IF v_row.status = 'registered' THEN
    UPDATE public.check_ins SET status = 'checklist' WHERE id = p_check_in_id;

    INSERT INTO public.status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
    VALUES (p_check_in_id, v_row.clinic_id, 'registered', 'checklist', 'tablet_anon');
  END IF;

  -- 고객 상세 정보 (있으면 birth_date 함께 반환)
  IF v_row.customer_id IS NOT NULL THEN
    SELECT name, phone, birth_date, chart_number
    INTO v_cust
    FROM public.customers
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

-- ── A4) fn_complete_prescreen_checklist — search_path 핀 + public. qualify (sms_opt_in AC-15 승계) ──
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
  -- check_in 조회
  SELECT id, status, clinic_id, customer_id
  INTO v_row
  FROM public.check_ins
  WHERE id = p_check_in_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 이미 완료된 경우 재제출 차단
  IF v_row.status NOT IN ('registered', 'checklist') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed', 'status', v_row.status);
  END IF;

  -- 1) checklists INSERT
  INSERT INTO public.checklists (clinic_id, customer_id, check_in_id, checklist_data, storage_path, completed_at)
  VALUES (v_row.clinic_id, v_row.customer_id, p_check_in_id, p_checklist_data, p_storage_path, now())
  RETURNING id INTO v_checklist_id;

  -- 2) check_ins.status → exam_waiting
  UPDATE public.check_ins
  SET status = 'exam_waiting'
  WHERE id = p_check_in_id;

  -- 3) status_transitions
  INSERT INTO public.status_transitions (check_in_id, clinic_id, from_status, to_status, changed_by)
  VALUES (p_check_in_id, v_row.clinic_id, v_row.status, 'exam_waiting', 'tablet_anon');

  -- 4) T-20260525-foot-MESSAGING-V1 AC-15:
  --    agree_marketing=false → customers.sms_opt_in = FALSE
  --    agree_marketing=true or absent → 기존 값 유지 (기본 TRUE)
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

COMMENT ON FUNCTION public.fn_complete_prescreen_checklist(UUID, JSONB, TEXT) IS
  'T-20260525-foot-MESSAGING-V1 AC-15: sms_opt_in 처리. + T-20260710 PIN-HARDEN: SET search_path='''' 핀 + public. qualify(§1-8 guardrail).';

COMMENT ON FUNCTION public.fn_prescreen_start(UUID) IS
  'T-20260430-foot-PRESCREEN: 태블릿 사전 체크리스트 진입(registered→checklist). + T-20260710 PIN-HARDEN: SET search_path='''' 핀 + public. qualify(§1-8 guardrail).';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (apply 후 supervisor DB-GATE proconfig 핀 대조)
-- ══════════════════════════════════════════════════════════════════════════════
--   -- 1) search_path 핀 확인 (기대: 두 함수 모두 {search_path=""})
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('fn_prescreen_start','fn_complete_prescreen_checklist');
--   -- 기대: proconfig = {search_path=""}  (핀 전에는 NULL)
--
--   -- 2) SECURITY DEFINER 유지 확인 (기대: prosecdef = true)
--   SELECT p.proname, p.prosecdef
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('fn_prescreen_start','fn_complete_prescreen_checklist');
--
--   -- 3) anon EXECUTE 화이트리스트 유지 확인 (기대: 둘 다 true — 공개흐름 필수)
--   SELECT has_function_privilege('anon','public.fn_prescreen_start(uuid)','EXECUTE');                    -- true
--   SELECT has_function_privilege('anon','public.fn_complete_prescreen_checklist(uuid,jsonb,text)','EXECUTE'); -- true

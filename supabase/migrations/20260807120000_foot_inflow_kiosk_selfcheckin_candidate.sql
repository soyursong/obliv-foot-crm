-- T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE  (dev-foot)
-- 키오스크(태블릿 사전 체크리스트=환자 셀프리포트) 유입경로 커버리지 lane — candidate 캡처 ONLY.
-- 부모 T-20260801-xcrm-INFLOW-CHANNEL-11CODE-INTAKE / 선행 T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE(deploy-ready).
-- assignee: dev-foot | db_change: true | 전량 ADDITIVE (신규 nullable 1컬럼 + fn_complete_prescreen_checklist candidate write)
-- 2026-08-07 12:00 KST
-- ★ 착수 GATE = CLEARED: data-architect RESOLVED 조건부 GO(ADDITIVE) — MSG-20260801-194223-aao9.
--    SSOT=da_decision_foot_kiosk_selfcheckin_inflow_coverage_20260801 / codify=cross_crm_data_contract §36 trust-tier 부속.
-- =====================================================
-- DA 하드제약(집행):
--   ① 환자 셀프리포트 = lower-trust "candidate" → 신규 hint 컬럼 check_ins.inflow_channel_self_reported (ADDITIVE, nullable).
--   ② canonical check_ins.inflow_channel 직접 write 절대 금지 — NULL(pending) 유지. 스태프 커밋(NewCheckInDialog)/
--      TM auto-stamp 때만 채움. 본 마이그/함수는 canonical inflow_channel 무접점.
--   ③ customers.first_inflow_channel 키오스크 write 절대 금지(셀프리포트=first-touch 자격無) — 본 함수 미접촉.
--   ④ 방화벽(§36 Q3): 구 referral_source(방문경로) 버튼값 → 11코드 canonical 자동 매핑/치환 금지(NO-GO).
--      셀프리포트 원문(네이버 검색/지인 소개/SNS·인스타/블로그/TV·언론/기타 등)을 verbatim 저장. 코드 변환 0.
--      referral_source/visit_route(legacy) 동결 불변 — 본 마이그 read/write 0.
--   ⑤ DoD 분자 provenance ∈ {staff_committed, tm_autostamp}만 — self_reported=candidate(분자 제외).
-- ADDITIVE-safe 근거:
--   · 신규 컬럼 nullable → 기존 row·grain·집계 무변경. DROP/타입변경/enum제거 0. forward-only(소급 UPDATE 없음).
--   · fn_complete_prescreen_checklist = 로직 승계(20260710224000 PIN-HARDEN 정본) + candidate write 1줄 추가.
--     search_path='' 핀 + public. qualify + SECDEF + OWNER postgres + anon EXECUTE 전량 보존(회귀 0).
--   · 멱등: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- ⚠ top-level BEGIN/COMMIT 없음(무영속 dry-run 러너 harness 호환, migration_dryrun_no_persistence_standard.md v1.0).
-- =====================================================
-- ⚠ FIX (2026-08-07, FIX-REQUEST MSG-20260807-160622-wyme / supervisor NO-GO C12 REF-COLUMN GUARD):
--   [근본원인 — prod 실측(Management API/information_schema, 파일 lineage 아님)]
--     checklists 실컬럼집합 = {id,clinic_id,customer_id,check_in_id,checklist_data,completed_at,created_at}.
--     → 선언 정본 20260506000030_checklists_table.sql 의 storage_path·started_at 2컬럼이 prod 에 미착지(드리프트).
--     → 본 함수 Step1 INSERT 가 참조하는 checklists.storage_path 가 prod-ABSENT → 42703 로 Step1 abort →
--        Step5 candidate write(이 티켓 feature) 도달불가 = 기능 by-construction 무력.
--     → LIVE 함수(pg_get_functiondef md5=9294361a4590aa1597dbbf83f3afe927, 2026-08-07 Management API 재실측)도
--        동일 storage_path INSERT 를 이미 참조(pg_get_functiondef 내 'storage_path' position=113·prosecdef=t·
--        proconfig={search_path=""}·anon EXECUTE=t) = 키오스크 체크리스트 제출 전반이 현재도 latent 42703 로
--        깨진 상태(check_function_bodies=off 라 CREATE 시 미검출).
--     → C12 REF-COLUMN GUARD 재실행(mig_ref_column_guard.py, Management API introspection): verdict=PASS·
--        storage_path=resolved_in_set(Step0 선행 ADD COLUMN)·나머지 12ref=mgmt:present·absent=[]·order_violation=[].
--   [해소 — 옵션 A(ADDITIVE 원장 정합 복원), Migration Ledger Reconciliation SOP 준거]
--     Step 0 신설: 선언 정본(20260506000030) 이 의도했으나 prod 로 드리프트한 checklists.storage_path·started_at 을
--     ADD COLUMN IF NOT EXISTS 로 복원(nullable/defaulted, 0-row 테이블 → 무손상·무집계영향).
--     · storage_path = FE(TabletChecklistPage.tsx:407 / HealthQMobilePage.tsx:515)가 p_storage_path(합본 PDF 경로)로
--       실제 전달 중 → 살아있는 feature(옵션 B 폐기판단은 오답). 복원 후 함수 INSERT 정상화 →
--       candidate write(Step5) 도달가능 + 키오스크 체크리스트 제출 전반의 latent 42703 동반 해소(별 P0 성격).
--     · started_at = 동일 선언표에서 함께 드리프트(함수 미참조라 blocking 은 아니나 원장 정합 위해 동반 복원).
--   [종이선언 db-repair 아님] 정본=prod 실재 기준. 20260506000030 은 CREATE TABLE 로 이 2컬럼을 declared →
--     prod 로 미착지분을 ADDITIVE 로 정직 재수렴(forward-doc). DROP/타입변경/enum 0.
-- =====================================================

-- ════════════════════════════════════════════════════════════════════
-- Step 0: [LEDGER RECONCILIATION] checklists 선언정본(20260506000030) 드리프트 복원 (ADDITIVE)
--   prod 실측 상 storage_path·started_at 미착지 → 함수 Step1 INSERT(storage_path) 42703 원천.
--   IF NOT EXISTS 멱등 · nullable/defaulted · 0-row 테이블 → 무손상.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.checklists ADD COLUMN IF NOT EXISTS storage_path TEXT;
COMMENT ON COLUMN public.checklists.storage_path IS
  'documents 버킷 합본 PDF(체크리스트+개인정보) 경로 (선택). 선언정본 20260506000030 declared intent 를 '
  'prod 드리프트에서 ADDITIVE 복원(FIX-REQUEST MSG-20260807-160622-wyme, C12). FE p_storage_path 로 전달됨.';
ALTER TABLE public.checklists ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
COMMENT ON COLUMN public.checklists.started_at IS
  '체크리스트 작성 시작시각 (선언정본 20260506000030 declared intent, ADDITIVE 복원). 함수 미참조(DEFAULT now()).';

-- ════════════════════════════════════════════════════════════════════
-- Step 1: candidate hint 컬럼 (nullable ADDITIVE) — 환자 셀프리포트 lower-trust 착지점
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS inflow_channel_self_reported text;
COMMENT ON COLUMN public.check_ins.inflow_channel_self_reported IS
  'T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE: 환자 셀프리포트(키오스크/태블릿 체크리스트) 유입경로 CANDIDATE(lower-trust). '
  '원문 verbatim(구 referral_source 버튼값 등) — 11코드 canonical 매핑/치환 금지(§36 Q3 방화벽). '
  'canonical inflow_channel(신뢰층)과 별칭=trust-tier 방화벽. DoD 분자 provenance{staff_committed,tm_autostamp}에서 제외(candidate). '
  '스태프-대면 advisory crosswalk hint UX 소스(비권위·참고). referral_source(freeze legacy)와 무접점.';

-- ════════════════════════════════════════════════════════════════════
-- Step 2: fn_complete_prescreen_checklist — 로직 승계(20260710224000 PIN-HARDEN 정본) + candidate write
--   ★ 유일 델타 = 체크리스트 유입경로(referral_source) 셀프리포트를 candidate 컬럼에 verbatim 저장(canonical 무접점).
-- ════════════════════════════════════════════════════════════════════
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
  v_self_report  TEXT;
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

  -- 5) ★ T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE (candidate ONLY):
  --    환자 셀프리포트 유입경로(referral_source)를 lower-trust candidate 로 저장.
  --    ⚠ canonical check_ins.inflow_channel 은 절대 미접촉(NULL 유지 — 스태프 커밋/TM auto-stamp 전용).
  --    ⚠ 원문 verbatim 저장 — 구 버튼값→11코드 자동 매핑/치환 금지(§36 Q3 방화벽). customers.first_inflow_channel 무접점.
  v_self_report := NULLIF(btrim(p_checklist_data->>'referral_source'), '');
  IF v_self_report IS NOT NULL THEN
    UPDATE public.check_ins
    SET inflow_channel_self_reported = v_self_report
    WHERE id = p_check_in_id;
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
  'T-20260525-foot-MESSAGING-V1 AC-15: sms_opt_in 처리. + T-20260710 PIN-HARDEN: SET search_path='''' 핀 + public. qualify(§1-8 guardrail). '
  '+ T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE: 셀프리포트 유입경로 candidate(check_ins.inflow_channel_self_reported) verbatim 저장 — canonical inflow_channel 무접점(방화벽).';

-- PostgREST 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor MIG-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════
-- 컬럼 존재(1행, is_nullable='YES'):
--   SELECT column_name, is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='check_ins' AND column_name='inflow_channel_self_reported';
-- canonical 무접점 회귀(함수 본문에 inflow_channel(단독) write 부재 — self_reported 만):
--   SELECT pg_get_functiondef('public.fn_complete_prescreen_checklist(uuid,jsonb,text)'::regprocedure);
-- search_path 핀 유지(기대: {search_path=""}):
--   SELECT p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist';
-- anon EXECUTE 유지(기대: true):
--   SELECT has_function_privilege('anon','public.fn_complete_prescreen_checklist(uuid,jsonb,text)','EXECUTE');

-- ============================================================
-- T-20260616-foot-OPINION-DOC-FEATURE (Phase 2): 소견서 = KOH form 스택 재사용 (정본)
-- 김주연 총괄 (#foot, 채널 C0ATE5P6JTH, thread 1781491923.605529)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260616160000_opinion_doc_form_stack.rollback.sql
-- 작성: dev-foot / 2026-06-16
-- ============================================================
-- 설계 근거: data-architect 재판정 = GO_REUSE_A (MSG-20260616-151210-xxy7 / INFO-151227-ttta).
--   소견서 = 전용테이블 신설 X, KOH 와 동일 의료문서 라이프사이클 →
--   form_templates(form_key='opinion_doc') + form_submissions(status='published') 재사용.
--   ⛔ 1차 DA 확정 2테이블(opinion_doc_templates/opinion_documents)은 SUPERSEDE/WITHDRAWN(20260616120000.*.WITHDRAWN).
--   cross_crm_data_contract §2-7 v2(v1.14.1, DA 소유) 정합.
--
-- 본 마이그 = ADDITIVE only(파괴 0). 대표 게이트 면제(autonomy §3.1), supervisor DDL-diff 게이트만.
--   1. ★C1(CRITICAL, 비협상): form_submissions published 행 비가역 하드닝(의료법 제22조).
--      (a) BEFORE UPDATE OR DELETE 트리거 → OLD.status='published' 면 RAISE(KOH 발행본도 동시 보호).
--      (b) form_submissions_update USING 에 status <> 'published' 술어 추가(이중방어).
--      ※ draft/printed/signed/voided/completed 라이프사이클 무영향(OLD.status='published' 만 차단).
--      ※ 2026-06-16 probe: 현 prod published 행 0건 → 기존행 회귀 위험 0.
--   2. opinion_doc form_template seed(OPINIONCERT/KOH 동일 패턴: html + field_map=옵션/문구 그리드).
--      AC-8 설정 UI = 기존 form_templates CRUD 재사용(field_map 편집). 신규 enum/컬럼 불요.
--   3. publish_opinion_doc RPC = publish_koh_result 동형(권한게이트 + snapshot 병합 + atomic insert).
--      자동채번 불요. C4 정정=신규 발행(supersede) → KOH 식 dup-block 미적용(append-only).
--      C3 정정 체인 = field_data.supersedes_id (self-FK 컬럼 신설 대신 field_data 채택 — KOH
--        field_data.koh_service_id 연결 선례와 동형, 스키마 churn 0. 비차단, 문서화).
--
-- ※ form_submissions.status CHECK 의 'published' 는 KOH 마이그(20260615190000)에서 이미 추가됨 → 재추가 안 함.
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 (★C1, CRITICAL): form_submissions published 행 비가역 하드닝
--   현 form_submissions_update RLS = 동일 clinic 멤버 누구나 published 행 UPDATE 허용 +
--   immutability 트리거 부재 → 의료법 제22조 위반 잠복 갭. 소견서·KOH 발행본 동시 보호.
-- ════════════════════════════════════════════════════════════════════════════

-- (a) 비가역 가드 트리거 — published 행의 UPDATE/DELETE 차단(RLS 우회 경로 service_role 등 포함 이중방어).
--     OLD.status='published' 일 때만 RAISE → draft/printed/signed/voided/completed 무영향.
CREATE OR REPLACE FUNCTION public.form_submissions_published_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION '발행된 의무기록(소견서·검사결과지)은 수정·삭제할 수 없습니다 — 정정은 신규 발행으로만 가능합니다'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.form_submissions_published_immutable_guard() IS
  'T-20260616-foot-OPINION-DOC-FEATURE C1: form_submissions published 행 UPDATE/DELETE 차단(의료법 제22조). KOH 결과지+소견서 발행본 공통 보호. non-published 라이프사이클 무영향.';

DROP TRIGGER IF EXISTS trg_form_submissions_published_immutable ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_published_immutable
  BEFORE UPDATE OR DELETE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.form_submissions_published_immutable_guard();

-- (b) form_submissions_update USING 에 status <> 'published' 이중방어 술어 추가.
--     기존 정책(20260522000010) = clinic 멤버 한정만 → published 술어 결합.
DROP POLICY IF EXISTS "form_submissions_update" ON public.form_submissions;
CREATE POLICY "form_submissions_update" ON public.form_submissions
  FOR UPDATE USING (
    status <> 'published'
    AND clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: opinion_doc form_template seed (옵션/문구 그리드 = field_map)
--   template_format='html' — 인쇄는 FE getHtmlTemplate('diag_opinion') 재사용(신규 출력 스택 금지).
--   field_map.sections = 팝업 옵션 그리드(진단서/금기증) + 자동삽입 문구. AC-8 설정 UI 가 본 행을 CRUD.
--   ON CONFLICT (clinic_id, form_key) DO UPDATE — 재실행 idempotent(KOH seed 동일 패턴).
-- ════════════════════════════════════════════════════════════════════════════
DO $seed$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8'; -- 오블리브 풋센터 종로
BEGIN
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'opinion_doc',
    '소견서',
    '', 'html',
    '{
      "print_template_key": "diag_opinion",
      "sections": [
        {"title":"진단서","options":[
          {"key":"oral_o","label":"경구약 O","phrase":"경구약 복용이 가능한 상태로 확인됩니다."},
          {"key":"oral_x","label":"경구약 X","phrase":"경구약 복용이 어려운 상태로 확인됩니다."},
          {"key":"after_1m","label":"약복용 1달 후","phrase":"약 복용 1개월 후 경과 관찰이 필요합니다."},
          {"key":"medical_staff","label":"의료진","phrase":"의료진 판단 하에 진료를 진행하였습니다."}
        ]},
        {"title":"금기증","options":[
          {"key":"hyperlipidemia","label":"고지혈증","phrase":"고지혈증 관련 사항을 확인하였습니다."},
          {"key":"gi_disorder","label":"위장장애","phrase":"위장장애 관련 사항을 확인하였습니다."},
          {"key":"oral_ineffective","label":"경구약 효과미비","phrase":"경구약 복용 효과가 미비하여 추가 조치를 고려합니다."},
          {"key":"gi_after_oral","label":"경구약복용후 위장장애","phrase":"경구약 복용 후 위장장애가 확인됩니다."},
          {"key":"bp_med","label":"혈압약","phrase":"혈압약 복용 이력을 확인하였습니다."},
          {"key":"cardio_med","label":"심혈관약","phrase":"심혈관계 약물 복용 이력을 확인하였습니다."},
          {"key":"liver_disease","label":"간질환","phrase":"간질환 관련 사항을 확인하였습니다."},
          {"key":"hbv_carrier","label":"간염보균자","phrase":"간염 보균 여부를 확인하였습니다."},
          {"key":"kidney_disease","label":"신장질환","phrase":"신장질환 관련 사항을 확인하였습니다."},
          {"key":"gout_med","label":"통풍약","phrase":"통풍약 복용 이력을 확인하였습니다."},
          {"key":"thyroid_med","label":"갑상선약","phrase":"갑상선약 복용 이력을 확인하였습니다."},
          {"key":"male_hairloss_med","label":"남성 탈모약","phrase":"남성 탈모약 복용 이력을 확인하였습니다."},
          {"key":"female_hairloss_med","label":"여성 탈모약","phrase":"여성 탈모약 복용 이력을 확인하였습니다."},
          {"key":"psychiatric_med","label":"항정신과약","phrase":"항정신과 약물 복용 이력을 확인하였습니다."},
          {"key":"on_chemo","label":"항암중","phrase":"항암 치료 중인 상태를 확인하였습니다."},
          {"key":"post_chemo_followup","label":"항암 후 추적","phrase":"항암 치료 후 추적 관찰 중임을 확인하였습니다."},
          {"key":"preparing_pregnancy","label":"임신준비중","phrase":"임신 준비 중인 상태를 확인하였습니다."},
          {"key":"pregnant","label":"임신중","phrase":"임신 중인 상태를 확인하였습니다."},
          {"key":"breastfeeding","label":"수유중","phrase":"수유 중인 상태를 확인하였습니다."},
          {"key":"pilot","label":"파일럿","phrase":"항공 종사자(파일럿) 직군임을 확인하였습니다."},
          {"key":"driver","label":"운전기사","phrase":"운전 직군임을 확인하였습니다."},
          {"key":"immune_disease","label":"면역질환","phrase":"면역질환 관련 사항을 확인하였습니다."},
          {"key":"diabetes","label":"당뇨","phrase":"당뇨 관련 사항을 확인하였습니다."},
          {"key":"pediatric","label":"소아","phrase":"소아 환자임을 확인하였습니다."}
        ]}
      ]
    }'::jsonb,
    false, 'admin|manager|director|consultant|coordinator|technician|therapist', true, 120
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;
END
$seed$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: publish_opinion_doc RPC (발행 = published insert, atomic)
--   publish_koh_result 동형: 권한게이트(C2) + clinic/customer 해석 + snapshot 병합 + insert.
--   append-only(C4) — KOH dup-block 미적용. 정정=신규 발행(field_data.supersedes_id, C3).
--   issued_by = staff.id(auth.uid()), nullable. 진료의(clinic_doctors) 스냅샷은 field_data.doctor_name 등.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.publish_opinion_doc(p_check_in_id uuid, p_field_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic       uuid;
  v_customer     uuid;
  v_chart        text;
  v_template     uuid;
  v_staff        uuid;
  v_final_text   text;
  v_published_at text;
  v_field        jsonb;
  v_new_id       uuid;
BEGIN
  -- C2: 발행 게이트 = isDoctorRole(director|doctor) = is_admin_or_manager(admin|manager|director).
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION '소견서 발행은 원장(의료진) 권한입니다' USING ERRCODE = '42501';
  END IF;

  -- 대상 내방(check_in) → clinic/customer 해석.
  SELECT ci.clinic_id, ci.customer_id
    INTO v_clinic, v_customer
    FROM check_ins ci
   WHERE ci.id = p_check_in_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '내방 정보를 찾을 수 없습니다: %', p_check_in_id;
  END IF;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION '고객(customer) 연결이 없어 소견서를 발행할 수 없습니다';
  END IF;

  -- 최종본(수기 SSOT, C4) 필수 — 빈 본문 발행 차단.
  v_final_text := COALESCE(NULLIF(btrim(p_field_data->>'final_text'), ''), '');
  IF v_final_text = '' THEN
    RAISE EXCEPTION '소견 내용을 입력해야 발행할 수 있습니다' USING ERRCODE = '23514';
  END IF;

  -- opinion_doc 템플릿(provenance).
  SELECT id INTO v_template
    FROM form_templates
   WHERE clinic_id = v_clinic AND form_key = 'opinion_doc' AND active = true
   LIMIT 1;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'opinion_doc form_template not found for clinic %', v_clinic;
  END IF;

  -- 차트번호 스냅샷(SoT=customers, denorm — 출력 재현용).
  SELECT chart_number INTO v_chart FROM customers WHERE id = v_customer;

  -- issued_by = staff.id (≠ user_profiles.id), nullable(20260522000010). 진료의 스냅샷은 field_data.
  SELECT id INTO v_staff FROM staff WHERE user_id = auth.uid() LIMIT 1;

  v_published_at := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS');

  -- field_data 병합: FE 전달(final_text/selected_option_keys/source_option_name/doctor_name/면허/진료의id/supersedes_id)
  --   + 서버 스냅샷(chart_no/published_at) + 연결키(check_in_id). 스키마 무변경.
  v_field := COALESCE(p_field_data, '{}'::jsonb)
    || jsonb_build_object(
         'final_text',   v_final_text,
         'chart_no',      COALESCE(v_chart, p_field_data->>'chart_no', ''),
         'published_at',  v_published_at,
         'check_in_id',   p_check_in_id::text,
         'doc_kind',      'opinion_doc'
       );

  INSERT INTO form_submissions (
    clinic_id, template_id, check_in_id, customer_id, issued_by,
    field_data, status, printed_at
  ) VALUES (
    v_clinic, v_template, p_check_in_id, v_customer, v_staff,
    v_field, 'published', now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'published_at', v_published_at);
END;
$$;

COMMENT ON FUNCTION public.publish_opinion_doc(uuid, jsonb) IS
  'T-20260616-foot-OPINION-DOC-FEATURE: 소견서 발행(published insert). publish_koh_result 동형(권한게이트 is_admin_or_manager + snapshot 병합 + atomic). append-only(정정=신규발행, field_data.supersedes_id). 비가역성=form_submissions published 트리거(C1).';

REVOKE ALL ON FUNCTION public.publish_opinion_doc(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_opinion_doc(uuid, jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: 검증 (supervisor DDL-diff self-check)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_update_qual text;
BEGIN
  -- C1-a: 트리거 존재(BEFORE UPDATE OR DELETE).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname='trg_form_submissions_published_immutable' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'C1 트리거 생성 실패'; END IF;

  -- C1-b: form_submissions_update USING 에 published 술어 결합 확인.
  SELECT qual INTO v_update_qual FROM pg_policies
   WHERE schemaname='public' AND tablename='form_submissions' AND policyname='form_submissions_update';
  IF v_update_qual IS NULL OR v_update_qual NOT LIKE '%published%' THEN
    RAISE EXCEPTION 'C1 form_submissions_update published 술어 추가 실패: %', v_update_qual; END IF;

  -- 2: opinion_doc 템플릿 seed.
  IF NOT EXISTS (
    SELECT 1 FROM form_templates WHERE form_key='opinion_doc' AND active=true
  ) THEN RAISE EXCEPTION 'opinion_doc form_template seed 실패'; END IF;

  -- 3: publish_opinion_doc RPC.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='publish_opinion_doc')
  THEN RAISE EXCEPTION 'publish_opinion_doc RPC 생성 실패'; END IF;

  RAISE NOTICE 'T-20260616-foot-OPINION-DOC-FEATURE form 스택: C1 하드닝 + opinion_doc seed + publish RPC 검증 통과';
END
$verify$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor DDL-diff)
-- ============================================================
-- [ ] ① 파괴 0       : 트리거/RLS술어/seed/RPC 추가만. 기존 테이블·컬럼 ALTER·DROP 없음.
-- [ ] ② C1 published 비가역 : UPDATE published 행 시도 → '발행된 의무기록…' 예외.
--                              + form_submissions_update USING 에 status<>'published'.
-- [ ] ③ KOH 무회귀  : draft/printed/signed/voided/completed 행 UPDATE 정상(트리거는 OLD.status='published' 만 차단).
--                      현 prod published 행 0건 → 기존행 회귀 0.
-- [ ] ④ 발행 게이트 : publish_opinion_doc → is_admin_or_manager() 외 호출 시 42501.
-- [ ] ⑤ clinic 격리 : publish RPC 가 check_in→clinic 해석, form_submissions RLS(clinic_id) 적용.
-- ============================================================

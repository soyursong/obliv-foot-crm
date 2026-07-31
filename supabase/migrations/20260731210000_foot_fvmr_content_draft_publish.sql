-- ============================================================
-- T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST
-- 초진 관리기록지 작성 내용 '저장(draft·재편집)/발행(공식·불변 이력)' 2계층
-- 김주연 총괄 (#foot, 채널 C0ATE5P6JTH) — field_confirm '둘 다'(2026-07-31 18:59)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260731210000_foot_fvmr_content_draft_publish.rollback.sql
-- 작성: dev-foot / 2026-07-31
-- ============================================================
-- 설계 근거: DA CONSULT-REPLY (da_consult_reply_foot_firstvisit_mgmtrecord_content_save_persist_20260731.md,
--   git 20:49:58 = 최종 정본, un-HOLD MSG-20260731-210513). verdict = 후보 B GO(draft행 재편집 + 발행 시
--   published 스냅샷 행 분리 INSERT) + change-class = minor-ADDITIVE.
--
--   ★핵심 재사용 machinery (전부 기존 — 신규 DDL 아님):
--     · status enum 'draft'/'published'          = 20260521070000 + 20260615190000(published)
--     · published 불변 트리거 trg_form_submissions_published_immutable = 20260616160000 SECTION 1(a)
--     · RLS form_submissions_update USING(status<>'published')          = 20260616160000 SECTION 1(b)
--     · form_submissions_insert / _read RLS(clinic-scope)               = 20260522000010
--   → 2계층(저장=draft UPDATE 허용 / 발행=published 동결)은 위 기존 방어막이 이미 정확히 구현.
--
--   본 마이그 = ADDITIVE only(파괴 0). 대표 게이트 면제(autonomy §3.1), supervisor PHI DB-GATE 게이트만.
--     (a) source_submission_id nullable FK → form_submissions.id ON DELETE SET NULL
--         = draft↔published lineage(어느 draft가 어느 published를 낳았는지). published 행에만 set,
--           draft 행은 NULL. ON DELETE SET NULL — draft 소실이 발행이력을 CASCADE 삭제하면 안 됨(의료법 §22).
--     (c) publish_first_visit_mgmt_record RPC = publish_opinion_doc 동형(snapshot 병합 + atomic insert).
--
--   ⚠ DEFERRED — DA 권장 (b) draft-dedup partial unique index (template_id, check_in_id) WHERE status='draft'
--     는 본 마이그에서 제외(보류). 사유: prod 실측(2026-07-31 dry-run) 결과 본 티켓 소관 밖 테이블에
--     기존 중복 draft 행 존재 → 전역 인덱스 즉시 생성 불가.
--       · opinion_doc(소견서) template c51efeba… check_in ff7f… = draft 2행(2026-07-24, 타 기능)
--       · template_id=NULL orphan draft(템플릿 삭제) check_in a213… = draft 2행 (+ NULL-template draft 15행)
--     supervisor DB-GATE ②('기존 draft 중복행 有 시 dedup 선행')가 예견한 조건. 그러나 그 dedup 대상은
--     초진 관리기록지가 아니라 opinion_doc·orphan(타 surface·고아행) → dev-foot 단독 파괴적 정정 금지
--     (인접 데이터 무접촉 원칙 + §S2.4). 인덱스는 그 cross-feature dedup(=DA/data-correction 소유) 선행 후
--     별건 ADDITIVE 마이그로 추가. planner FOLLOWUP 발행.
--     ★기능 무영향: 초진 관리기록지 draft 유일성은 FE(저장 전 기존 draft SELECT→UPDATE, else INSERT +
--       fvmrBusy 버튼가드)로 정상 보장(태블릿 단일사용자 동선). 인덱스는 동시성 belt-suspenders 하드닝일 뿐.
--         ★게이트 상이(CATCH2, DA REAFFIRM): 초진 관리기록지 = 비의료(치료사/코디) 작성 서류 →
--           is_doctor_role() 게이트 금지. is_approved_user()(승인 클리닉 직원 누구나)만.
--           (form_templates.required_role = admin|manager|coordinator|therapist, doctor 없음)
--         ★CATCH1: status='signed' 오버로드 금지 — draft='draft' / 발행='published' 만 사용.
--         append-only(재발행 허용) — draft는 발행 후에도 살아 재편집·재발행(새 published 스냅샷 INSERT).
--
--   ※ 사진(발 사진 2슬롯)은 본 건 소관 아님 — treatment_photos(부모=check_in, source='first_visit_mgmt_record')로
--     이미 prod-applied(commit a5c82413, T-...-PHOTO-2SLOT-LR). 단일수렴 앵커 = check_in_id(테이블 아님).
--     form_submissions.field_data 에 사진 넣지 않음(authoritative=treatment_photos). 본 마이그 신규 사진 DDL 0.
-- ============================================================

BEGIN;

-- ── (a) draft↔published lineage FK (ADDITIVE, nullable, ON DELETE SET NULL) ──
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS source_submission_id uuid
    REFERENCES form_submissions(id) ON DELETE SET NULL;

COMMENT ON COLUMN form_submissions.source_submission_id IS
  'draft→published lineage. published 행에만 set(어느 draft에서 발행됐는지), draft 행은 NULL. ON DELETE SET NULL(draft 소실이 발행이력을 CASCADE 삭제하지 않음, 의료법 §22). T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST.';

-- (b) draft-dedup partial unique index = DEFERRED (헤더 주석 참조). cross-feature dedup 선행 필요 → 별건.

-- ════════════════════════════════════════════════════════════════════════════
-- (c) publish_first_visit_mgmt_record RPC — 발행 = published 스냅샷 행 atomic INSERT.
--   publish_opinion_doc 동형(snapshot 병합 + atomic). 게이트만 상이(CATCH2):
--     is_approved_user()(승인 클리닉 직원 누구나) — is_doctor_role() 금지(비의료 작성 서류).
--   append-only(재발행 허용) — draft 존치. source_submission_id = 발행을 낳은 draft(lineage, 검증 후 set).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.publish_first_visit_mgmt_record(
  p_check_in_id uuid,
  p_field_data jsonb,
  p_source_submission_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic       uuid;
  v_customer     uuid;
  v_template     uuid;
  v_staff        uuid;
  v_source       uuid := NULL;
  v_published_at text;
  v_field        jsonb;
  v_new_id       uuid;
BEGIN
  -- CATCH2(DA REAFFIRM): 초진 관리기록지 = 비의료(치료사/코디/admin/manager) 작성 서류.
  --   의사 전용 게이트 금지 — 승인 클리닉 직원 누구나 발행(form_templates.required_role 정합).
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: 초진 관리기록지 발행은 승인 사용자 권한입니다' USING ERRCODE = '42501';
  END IF;

  IF p_field_data IS NULL THEN
    RAISE EXCEPTION '발행할 내용(field_data)이 없습니다' USING ERRCODE = '23514';
  END IF;

  -- 대상 내방(check_in) → clinic/customer 해석.
  SELECT ci.clinic_id, ci.customer_id
    INTO v_clinic, v_customer
    FROM check_ins ci
   WHERE ci.id = p_check_in_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '내방 정보를 찾을 수 없습니다: %', p_check_in_id;
  END IF;

  -- 초진 관리기록지 템플릿(provenance).
  SELECT id INTO v_template
    FROM form_templates
   WHERE clinic_id = v_clinic AND form_key = 'first_visit_mgmt_record' AND active = true
   LIMIT 1;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'first_visit_mgmt_record form_template not found for clinic %', v_clinic;
  END IF;

  -- lineage: 전달된 draft 가 (동일 template·동일 check_in·status='draft') 인 경우에만 set(그 외 NULL 방어).
  IF p_source_submission_id IS NOT NULL THEN
    SELECT id INTO v_source
      FROM form_submissions
     WHERE id = p_source_submission_id
       AND template_id = v_template
       AND check_in_id = p_check_in_id
       AND status = 'draft'
     LIMIT 1;
  END IF;

  -- issued_by = staff.id (≠ user_profiles.id), nullable(20260522000010).
  SELECT id INTO v_staff FROM staff WHERE user_id = auth.uid() LIMIT 1;

  v_published_at := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS');

  -- field_data 병합: FE 스냅샷 + 서버 스탬프(published_at/check_in_id/doc_kind). 스키마 무변경.
  v_field := COALESCE(p_field_data, '{}'::jsonb)
    || jsonb_build_object(
         'published_at', v_published_at,
         'check_in_id',  p_check_in_id::text,
         'doc_kind',     'first_visit_mgmt_record'
       );

  INSERT INTO form_submissions (
    clinic_id, template_id, check_in_id, customer_id, issued_by,
    field_data, status, source_submission_id, printed_at
  ) VALUES (
    v_clinic, v_template, p_check_in_id, v_customer, v_staff,
    v_field, 'published', v_source, now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'published_at', v_published_at);
END;
$$;

COMMENT ON FUNCTION public.publish_first_visit_mgmt_record(uuid, jsonb, uuid) IS
  'T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST: 초진 관리기록지 발행(published 스냅샷 INSERT). publish_opinion_doc 동형(snapshot 병합 + atomic). 게이트=is_approved_user()(비의료 작성 서류, CATCH2 — is_doctor_role 금지). append-only(재발행 허용, draft 존치). 비가역성=trg_form_submissions_published_immutable(기존). lineage=source_submission_id(발행 낳은 draft).';

REVOKE ALL ON FUNCTION public.publish_first_visit_mgmt_record(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_first_visit_mgmt_record(uuid, jsonb, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 검증 (supervisor DB-GATE self-check)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
BEGIN
  -- (a) lineage 컬럼 + ON DELETE SET NULL.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='form_submissions' AND column_name='source_submission_id'
  ) THEN RAISE EXCEPTION 'source_submission_id 컬럼 생성 실패'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.form_submissions'::regclass
       AND c.contype='f' AND c.confdeltype='n'  -- 'n' = SET NULL
       AND EXISTS (
         SELECT 1 FROM unnest(c.conkey) k
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k
         WHERE a.attname='source_submission_id')
  ) THEN RAISE EXCEPTION 'source_submission_id FK ON DELETE SET NULL 아님'; END IF;

  -- (b) draft-dedup partial unique index = DEFERRED(cross-feature dedup 선행) → 본 마이그 검증 대상 아님.

  -- (c) publish RPC + 게이트 정합(is_approved_user 사용 / is_doctor_role 미사용).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='publish_first_visit_mgmt_record')
  THEN RAISE EXCEPTION 'publish_first_visit_mgmt_record RPC 생성 실패'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname='publish_first_visit_mgmt_record'
     AND pg_get_functiondef(oid) LIKE '%is_approved_user()%'
  ) THEN RAISE EXCEPTION 'CATCH2 게이트=is_approved_user() 누락'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname='publish_first_visit_mgmt_record'
     AND pg_get_functiondef(oid) LIKE '%is_doctor_role()%'
  ) THEN RAISE EXCEPTION 'CATCH2 위반: publish_first_visit_mgmt_record 에 is_doctor_role 잔존(비의료 서류에 의사게이트 금지)'; END IF;
  -- CATCH1: signed 오버로드 금지 — RPC 본문에 status='signed' 미등장.
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname='publish_first_visit_mgmt_record'
     AND pg_get_functiondef(oid) LIKE '%''signed''%'
  ) THEN RAISE EXCEPTION 'CATCH1 위반: signed status 오버로드 잔존'; END IF;

  -- 기존 방어막 재확인(2계층 의존): published 불변 트리거 + RLS status<>'published'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname='trg_form_submissions_published_immutable' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION '의존 전제 실패: published 불변 트리거 부재'; END IF;

  RAISE NOTICE 'T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST: (a)lineage FK (c)publish RPC(is_approved_user 게이트) ADDITIVE 검증 통과 [(b)draft-dedup idx=DEFERRED]';
END
$verify$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor PHI DB-GATE)
-- ============================================================
-- [ ] ① 파괴 0        : 컬럼/RPC 추가만. 기존 status enum·트리거·RLS 무변경(재사용).
-- [ ] ② draft-dedup   : DEFERRED — 전역 인덱스는 cross-feature dedup(opinion_doc·orphan) 선행 후 별건. 본 마이그 미포함.
-- [ ] ③ lineage FK    : source_submission_id ON DELETE SET NULL(발행이력 CASCADE 소실 금지).
-- [ ] ④ 발행 게이트   : publish_first_visit_mgmt_record = is_approved_user()(비의료 서류 — is_doctor_role 아님).
-- [ ] ⑤ 비가역 재확인 : published 행 UPDATE/DELETE → trg_form_submissions_published_immutable RAISE(기존, 무변경).
-- [ ] ⑥ 사진 무접점   : treatment_photos(a5c82413) 무변경 — 본 마이그 신규 사진 DDL 0.
-- ============================================================

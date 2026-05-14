-- T-20260514-foot-DOC-4FORM-IMPL
-- 풋센터 양식 4종 신규 등록
--   1. payment_cert         — 진료비 납입증명서(소득공제용)
--   2. referral_letter      — 진료의뢰서
--   3. medical_record_request — 의무기록사본발급신청서 (의료법 §21)
--   4. diag_opinion_v2      — 소견서(보험청구용) variant
--
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)
-- template_format: 'html' — HTML/CSS 직접 렌더링 (이미지 없음)
-- 멱등: ON CONFLICT DO UPDATE — 재실행 안전
--
-- AC-6 결정: diag_opinion_v2 별도 등록 (기존 diag_opinion 교체 X)
--   사유: 보험청구용으로 목적·레이아웃 상이, 현장 교체 시 혼란 우려
--
-- Note: CHECK constraint 확장 포함
--   기존: CHECK (template_format IN ('jpg','png','pdf'))
--   변경: CHECK (template_format IN ('jpg','png','pdf','html'))
--   멱등 처리: 제약 이름 체크 후 존재 시 DROP→재생성

-- ────────────────────────────────────────────────────────────────
-- 0) CHECK constraint 확장 — 'html' 추가 (멱등)
-- ────────────────────────────────────────────────────────────────
DO $constraint$
BEGIN
  -- 기존 제약이 'html'을 포함하지 않는 경우에만 재생성
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'form_templates_template_format_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%html%'
  ) THEN
    ALTER TABLE form_templates
      DROP CONSTRAINT form_templates_template_format_check;
    ALTER TABLE form_templates
      ADD CONSTRAINT form_templates_template_format_check
        CHECK (template_format = ANY (ARRAY['jpg'::text, 'png'::text, 'pdf'::text, 'html'::text]));
  END IF;
END
$constraint$;

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 1) 진료비 납입증명서(소득공제용) — payment_cert
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'payment_cert',
    '진료비 납입증명서(소득공제용)',
    '', 'html',
    '[
      {"key":"patient_name",    "label":"환자성명",       "type":"text",   "x":0,"y":0},
      {"key":"patient_rrn",     "label":"주민등록번호",   "type":"text",   "x":0,"y":0},
      {"key":"patient_address", "label":"주소",           "type":"text",   "x":0,"y":0},
      {"key":"record_no",       "label":"등록번호",       "type":"text",   "x":0,"y":0},
      {"key":"recipient",       "label":"수신자",         "type":"text",   "x":0,"y":0},
      {"key":"year",            "label":"납입연도",       "type":"text",   "x":0,"y":0},
      {"key":"annual_total",    "label":"연간합계액",     "type":"amount", "x":0,"y":0},
      {"key":"issue_date",      "label":"발행일",         "type":"date",   "x":0,"y":0},
      {"key":"clinic_name",     "label":"의료기관명",     "type":"text",   "x":0,"y":0},
      {"key":"clinic_address",  "label":"사업자소재지",   "type":"text",   "x":0,"y":0},
      {"key":"business_reg_no", "label":"사업자등록번호", "type":"text",   "x":0,"y":0}
    ]'::jsonb,
    false, 'admin|manager', true, 85
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;

  -- ────────────────────────────────────────────────────────────────
  -- 2) 진료의뢰서 — referral_letter
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'referral_letter',
    '진료의뢰서',
    '', 'html',
    '[
      {"key":"patient_name",         "label":"환자성명",     "type":"text",      "x":0,"y":0},
      {"key":"patient_rrn",          "label":"주민등록번호", "type":"text",      "x":0,"y":0},
      {"key":"patient_phone",        "label":"연락처",       "type":"text",      "x":0,"y":0},
      {"key":"patient_gender",       "label":"성별",         "type":"text",      "x":0,"y":0},
      {"key":"patient_age",          "label":"나이",         "type":"text",      "x":0,"y":0},
      {"key":"patient_email",        "label":"E-mail",       "type":"text",      "x":0,"y":0},
      {"key":"referral_year",        "label":"의뢰연도",     "type":"text",      "x":0,"y":0},
      {"key":"referral_month",       "label":"의뢰월",       "type":"text",      "x":0,"y":0},
      {"key":"referral_day",         "label":"의뢰일",       "type":"text",      "x":0,"y":0},
      {"key":"dept_name",            "label":"진료과",       "type":"text",      "x":0,"y":0},
      {"key":"referring_doctor",     "label":"의뢰의사",     "type":"text",      "x":0,"y":0},
      {"key":"diagnosis",            "label":"진단명",       "type":"multiline", "x":0,"y":0},
      {"key":"medical_history",      "label":"병력및소견",   "type":"multiline", "x":0,"y":0},
      {"key":"referral_content",     "label":"의뢰내용",     "type":"multiline", "x":0,"y":0},
      {"key":"referral_to_hospital", "label":"의뢰병원",     "type":"text",      "x":0,"y":0},
      {"key":"clinic_name",          "label":"병원명",       "type":"text",      "x":0,"y":0},
      {"key":"clinic_phone",         "label":"전화/FAX",     "type":"text",      "x":0,"y":0},
      {"key":"doctor_name",          "label":"의사성명",     "type":"text",      "x":0,"y":0}
    ]'::jsonb,
    false, 'admin|manager|director', true, 90
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;

  -- ────────────────────────────────────────────────────────────────
  -- 3) 의무기록사본발급신청서 — medical_record_request
  --    의료법 제21조 관련 법정 양식
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'medical_record_request',
    '의무기록사본발급신청서',
    '', 'html',
    '[
      {"key":"patient_name",       "label":"환자성명",     "type":"text", "x":0,"y":0},
      {"key":"patient_rrn",        "label":"주민등록번호", "type":"text", "x":0,"y":0},
      {"key":"patient_address",    "label":"주소",         "type":"text", "x":0,"y":0},
      {"key":"record_no",          "label":"병록번호",     "type":"text", "x":0,"y":0},
      {"key":"request_purpose",    "label":"신청목적",     "type":"text", "x":0,"y":0},
      {"key":"record_section",     "label":"복사부문",     "type":"text", "x":0,"y":0},
      {"key":"requester_relation", "label":"신청인관계",   "type":"text", "x":0,"y":0},
      {"key":"requester_name",     "label":"신청인성명",   "type":"text", "x":0,"y":0},
      {"key":"issue_date",         "label":"신청일",       "type":"date", "x":0,"y":0},
      {"key":"doctor_name",        "label":"주치의",       "type":"text", "x":0,"y":0},
      {"key":"clinic_name",        "label":"의료기관명",   "type":"text", "x":0,"y":0}
    ]'::jsonb,
    true, 'admin|manager|coordinator', true, 95
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko           = EXCLUDED.name_ko,
    template_path     = EXCLUDED.template_path,
    template_format   = EXCLUDED.template_format,
    field_map         = EXCLUDED.field_map,
    requires_signature = EXCLUDED.requires_signature,
    required_role     = EXCLUDED.required_role,
    active            = EXCLUDED.active,
    sort_order        = EXCLUDED.sort_order;

  -- ────────────────────────────────────────────────────────────────
  -- 4) 소견서 variant — diag_opinion_v2 (보험청구용)
  --    기존 diag_opinion은 유지 (별도 등록)
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'diag_opinion_v2',
    '소견서(보험청구용)',
    '', 'html',
    '[
      {"key":"patient_name",        "label":"환자성명",     "type":"text",      "x":0,"y":0},
      {"key":"patient_rrn",         "label":"주민등록번호", "type":"text",      "x":0,"y":0},
      {"key":"patient_address",     "label":"주소",         "type":"text",      "x":0,"y":0},
      {"key":"disease_name",        "label":"병명",         "type":"text",      "x":0,"y":0},
      {"key":"inpatient_start",     "label":"입원시작일",   "type":"date",      "x":0,"y":0},
      {"key":"inpatient_end",       "label":"입원종료일",   "type":"date",      "x":0,"y":0},
      {"key":"outpatient_start",    "label":"외래시작일",   "type":"date",      "x":0,"y":0},
      {"key":"outpatient_end",      "label":"외래종료일",   "type":"date",      "x":0,"y":0},
      {"key":"assistive_device",    "label":"보조기명",     "type":"text",      "x":0,"y":0},
      {"key":"classification_code", "label":"분류번호",     "type":"text",      "x":0,"y":0},
      {"key":"device_start",        "label":"사용기간시작", "type":"date",      "x":0,"y":0},
      {"key":"device_end",          "label":"사용기간종료", "type":"date",      "x":0,"y":0},
      {"key":"onset_date",          "label":"발병일",       "type":"date",      "x":0,"y":0},
      {"key":"submit_to",           "label":"제출처",       "type":"text",      "x":0,"y":0},
      {"key":"opinion_text",        "label":"소견",         "type":"multiline", "x":0,"y":0},
      {"key":"remarks",             "label":"참고사항",     "type":"multiline", "x":0,"y":0},
      {"key":"issue_date",          "label":"발행일",       "type":"date",      "x":0,"y":0},
      {"key":"clinic_name",         "label":"의료기관명",   "type":"text",      "x":0,"y":0},
      {"key":"clinic_address",      "label":"병원주소",     "type":"text",      "x":0,"y":0},
      {"key":"clinic_phone",        "label":"전화번호",     "type":"text",      "x":0,"y":0},
      {"key":"doctor_name",         "label":"담당의사",     "type":"text",      "x":0,"y":0}
    ]'::jsonb,
    false, 'admin|manager|director', true, 100
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;

END $$;

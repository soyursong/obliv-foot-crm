-- T-20260525-foot-INS-FIELD-BIND: 보험청구서(ins_claim_form) field_map 바인딩 누락 수정
--
-- 근본 원인:
--   20260522040000_ins_doc_form_templates.sql 의 INSERT ... WHERE NOT EXISTS 패턴이
--   사전에 존재하던 DB 행에 의해 skip 되었을 가능성 → field_map 불완전 상태 잔류.
--
-- 수정:
--   INSERT ... ON CONFLICT (clinic_id, form_key) DO UPDATE 로 교체하여
--   diag_code/diag_name(상병코드·명) + patient_rrn/patient_address(주민번호·주소) 포함
--   완전한 field_map으로 강제 동기화.
--
-- AC-1: disease_code/disease_name 바인딩 → diag_code_1/diag_name_1 (DOC-CODE-INSERT 동일)
-- AC-2: resident_registration_number + address → patient_rrn + patient_address
-- AC-3: 전수 감사 — 이 migration 이후 ins_claim_form field_map 완전성 보장

INSERT INTO form_templates (
  clinic_id,
  category,
  form_key,
  name_ko,
  template_path,
  template_format,
  field_map,
  requires_signature,
  required_role,
  active,
  sort_order
)
VALUES (
  '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  'insurance',
  'ins_claim_form',
  '보험청구서',
  '',
  'html',
  '[
    {"key":"patient_name",           "label":"환자성명",     "type":"text",   "x":0,"y":0},
    {"key":"patient_rrn",            "label":"주민등록번호", "type":"text",   "x":0,"y":0},
    {"key":"patient_phone",          "label":"연락처",       "type":"text",   "x":0,"y":0},
    {"key":"patient_address",        "label":"주소",         "type":"text",   "x":0,"y":0},
    {"key":"insurance_grade_label",  "label":"건보 등급",    "type":"text",   "x":0,"y":0},
    {"key":"copay_rate",             "label":"본인부담률",   "type":"text",   "x":0,"y":0},
    {"key":"special_treatment_code", "label":"산정특례코드", "type":"text",   "x":0,"y":0},
    {"key":"diag_code_1",            "label":"주상병코드",   "type":"text",   "x":0,"y":0},
    {"key":"diag_name_1",            "label":"주상병명",     "type":"text",   "x":0,"y":0},
    {"key":"diag_code_2",            "label":"부상병코드",   "type":"text",   "x":0,"y":0},
    {"key":"diag_name_2",            "label":"부상병명",     "type":"text",   "x":0,"y":0},
    {"key":"visit_date",             "label":"진료일",       "type":"date",   "x":0,"y":0},
    {"key":"total_amount",           "label":"진료비합계",   "type":"amount", "x":0,"y":0},
    {"key":"insurance_covered",      "label":"공단부담금",   "type":"amount", "x":0,"y":0},
    {"key":"copayment",              "label":"본인부담금",   "type":"amount", "x":0,"y":0},
    {"key":"non_covered",            "label":"비급여",       "type":"amount", "x":0,"y":0},
    {"key":"issue_date",             "label":"발행일",       "type":"date",   "x":0,"y":0},
    {"key":"clinic_name",            "label":"의료기관명",   "type":"text",   "x":0,"y":0},
    {"key":"clinic_phone",           "label":"전화번호",     "type":"text",   "x":0,"y":0},
    {"key":"doctor_name",            "label":"담당의사",     "type":"text",   "x":0,"y":0}
  ]'::jsonb,
  false,
  'admin|manager|director|consultant|coordinator',
  true,
  10
)
ON CONFLICT (clinic_id, form_key)
DO UPDATE SET
  field_map        = EXCLUDED.field_map,
  template_format  = EXCLUDED.template_format,
  required_role    = EXCLUDED.required_role,
  active           = EXCLUDED.active,
  sort_order       = EXCLUDED.sort_order;

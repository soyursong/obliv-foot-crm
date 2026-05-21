-- T-20260522-foot-INS-DOC-PRINT: 보험서류 form_templates 시드
-- category = 'insurance' 로 분리, foot-service 서류와 UI 섹션 구분

-- ── 보험청구서 ───────────────────────────────────────────────────────────────
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
SELECT
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
  'admin|manager|coordinator',
  true,
  10
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates
  WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND form_key = 'ins_claim_form'
);

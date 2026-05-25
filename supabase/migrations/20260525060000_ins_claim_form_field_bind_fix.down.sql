-- T-20260525-foot-INS-FIELD-BIND rollback
-- 이전 field_map으로 복구 (patient_address, diag_code_1/2, diag_name_1/2 제거)
-- NOTE: ON CONFLICT DO UPDATE 이므로 완전 롤백은 이전 스냅샷이 필요.
--       아래는 원래 INSERT WHERE NOT EXISTS 기준값(bfd31ea)으로 복원.

UPDATE form_templates
SET field_map = '[
  {"key":"patient_name",           "label":"환자성명",     "type":"text",   "x":0,"y":0},
  {"key":"patient_rrn",            "label":"주민등록번호", "type":"text",   "x":0,"y":0},
  {"key":"patient_phone",          "label":"연락처",       "type":"text",   "x":0,"y":0},
  {"key":"insurance_grade_label",  "label":"건보 등급",    "type":"text",   "x":0,"y":0},
  {"key":"copay_rate",             "label":"본인부담률",   "type":"text",   "x":0,"y":0},
  {"key":"special_treatment_code", "label":"산정특례코드", "type":"text",   "x":0,"y":0},
  {"key":"visit_date",             "label":"진료일",       "type":"date",   "x":0,"y":0},
  {"key":"total_amount",           "label":"진료비합계",   "type":"amount", "x":0,"y":0},
  {"key":"insurance_covered",      "label":"공단부담금",   "type":"amount", "x":0,"y":0},
  {"key":"copayment",              "label":"본인부담금",   "type":"amount", "x":0,"y":0},
  {"key":"non_covered",            "label":"비급여",       "type":"amount", "x":0,"y":0},
  {"key":"issue_date",             "label":"발행일",       "type":"date",   "x":0,"y":0},
  {"key":"clinic_name",            "label":"의료기관명",   "type":"text",   "x":0,"y":0},
  {"key":"clinic_phone",           "label":"전화번호",     "type":"text",   "x":0,"y":0},
  {"key":"doctor_name",            "label":"담당의사",     "type":"text",   "x":0,"y":0}
]'::jsonb
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key  = 'ins_claim_form';

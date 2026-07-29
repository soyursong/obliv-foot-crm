-- ROLLBACK: T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2
-- 초진 관리기록지 field_map 을 base(T-20260728-DOCFORM-FIRSTVISIT-MGMTRECORD) 15-entry 로 복원.
-- 무DDL — 순수 데이터 UPDATE. 멱등.

UPDATE form_templates
SET field_map = '[
    {"key":"patient_name","label":"성명","type":"text","x":0,"y":0},
    {"key":"patient_birthdate","label":"생년월일","type":"text","x":0,"y":0},
    {"key":"patient_phone","label":"연락처","type":"text","x":0,"y":0},
    {"key":"visit_date","label":"초진일","type":"date","x":0,"y":0},
    {"key":"vp_other_text","label":"방문목적 기타","type":"text","x":0,"y":0},
    {"key":"symptom_history","label":"증상 발생 경위","type":"multiline","x":0,"y":0,"w":400,"h":60},
    {"key":"nail_status","label":"발톱 상태","type":"multiline","x":0,"y":0,"w":400,"h":40},
    {"key":"skin_status","label":"피부 상태","type":"multiline","x":0,"y":0,"w":400,"h":40},
    {"key":"other_check","label":"기타 확인 사항","type":"multiline","x":0,"y":0,"w":400,"h":40},
    {"key":"care_other_text","label":"초기관리 기타","type":"text","x":0,"y":0},
    {"key":"care_plan","label":"관리 계획","type":"multiline","x":0,"y":0,"w":400,"h":60},
    {"key":"remarks","label":"특이사항","type":"multiline","x":0,"y":0,"w":400,"h":60},
    {"key":"issue_date","label":"발급일","type":"date","x":0,"y":0},
    {"key":"clinic_name","label":"센터명","type":"text","x":0,"y":0},
    {"key":"doctor_name","label":"담당자","type":"text","x":0,"y":0}
  ]'::jsonb
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND form_key = 'first_visit_mgmt_record';

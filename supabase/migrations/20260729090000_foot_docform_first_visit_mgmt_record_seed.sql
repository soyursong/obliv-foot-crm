-- T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD
-- 초진 관리기록지 form_templates ADDITIVE seed row (무DDL — 순수 데이터 INSERT).
--
-- 근거: 운영 form_templates(foot-service) 22행 실측 → FALLBACK 미사용(footDbTpls>0 경로).
--   신규 서류 목록 노출엔 (a)DOCLIST_ORDER_10 화이트리스트(코드, 배포) + (b)본 seed row 둘 다 필요.
-- 성격: ADDITIVE only. 스키마 무변경(신규 컬럼/테이블/enum 없음) → db_change=false 유지, MIG-GATE/DA-CONSULT 비대상.
-- 멱등: 동일 (clinic_id, form_key) 존재 시 no-op(WHERE NOT EXISTS). 재실행 안전.
-- 롤백: 20260729090000_..._seed.rollback.sql (scoped DELETE).

INSERT INTO form_templates
  (clinic_id, category, form_key, name_ko, template_path, template_format,
   field_map, requires_signature, required_role, active, sort_order)
SELECT
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  'foot-service',
  'first_visit_mgmt_record',
  '초진 관리기록지',
  '',
  'html',
  '[
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
  ]'::jsonb,
  false,
  'admin|manager|coordinator|therapist',
  true,
  130
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates
  WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND form_key = 'first_visit_mgmt_record'
);

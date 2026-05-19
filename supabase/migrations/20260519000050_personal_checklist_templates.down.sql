-- Rollback: T-20260519-foot-PENCHART-FORM-ADD
-- 개인정보+체크리스트 합본 양식 2종 제거

DELETE FROM form_templates
WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior')
  AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

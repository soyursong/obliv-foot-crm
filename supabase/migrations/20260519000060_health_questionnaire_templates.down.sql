-- T-20260519-foot-HEALTH-Q-PEN rollback
DELETE FROM form_templates
WHERE form_key IN ('health_questionnaire_general', 'health_questionnaire_senior')
  AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

-- personal_checklist_* sort_order 원복
UPDATE form_templates
SET sort_order = sort_order - 10
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key IN ('personal_checklist_general', 'personal_checklist_senior');

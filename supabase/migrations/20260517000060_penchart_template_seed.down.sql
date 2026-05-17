-- Rollback: pen_chart 템플릿 비활성화
-- T-20260517-foot-PENCHART-FORM

UPDATE form_templates
SET active = false
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key = 'pen_chart';

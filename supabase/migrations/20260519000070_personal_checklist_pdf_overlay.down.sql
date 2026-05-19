-- T-20260519-foot-PENCHART-FORM-ADD FIX 롤백
-- pdf_overlay → html 복원, template_path 초기화
-- CHECK constraint를 'pdf_overlay' 제거 전 상태로 복원

-- 1) personal_checklist 행을 html(레거시) 상태로 복원
UPDATE form_templates
SET
  template_path   = '',
  template_format = 'html',
  sort_order      = CASE
    WHEN form_key = 'personal_checklist_general' THEN 101
    WHEN form_key = 'personal_checklist_senior'  THEN 102
    ELSE sort_order
  END
WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior')
  AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

-- 2) CHECK constraint에서 'pdf_overlay' 제거
ALTER TABLE form_templates
  DROP CONSTRAINT IF EXISTS form_templates_template_format_check;

ALTER TABLE form_templates
  ADD CONSTRAINT form_templates_template_format_check
  CHECK (template_format = ANY (ARRAY[
    'jpg'::text,
    'png'::text,
    'pdf'::text,
    'html'::text
  ]));

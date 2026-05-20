-- T-20260520-foot-PENCHART-CHECKLIST-REMOVE rollback
-- 개인정보+체크리스트 2종 재활성화 (soft-delete 복원)
UPDATE form_templates
SET active = true
WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior');

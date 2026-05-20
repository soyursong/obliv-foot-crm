-- T-20260520-foot-PENCHART-CHECKLIST-REMOVE
-- 개인정보+체크리스트 2종 form_templates soft-delete
-- 현장 요청: 불필요 판단 → select 패널에서 제거
-- form_submissions 참조 없음 (dry-run 확인됨) — 기존 저장 데이터 보존 목적 soft-delete
UPDATE form_templates
SET active = false
WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior');

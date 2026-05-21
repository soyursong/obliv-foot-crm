-- ROLLBACK: form_submissions.template_id 다시 NOT NULL
-- 주의: NULL 값이 이미 존재하면 실패할 수 있음.
-- 먼저 NULL 행 정리 후 실행:
--   DELETE FROM form_submissions WHERE template_id IS NULL;

ALTER TABLE form_submissions ALTER COLUMN template_id SET NOT NULL;

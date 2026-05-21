-- Rollback: 20260521070000_form_submissions_status_completed.sql
-- 'completed'를 다시 제거 (원래 4종으로 복원)

ALTER TABLE form_submissions
  DROP CONSTRAINT IF EXISTS form_submissions_status_check;

ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_status_check
  CHECK (status IN ('draft', 'printed', 'signed', 'voided'));

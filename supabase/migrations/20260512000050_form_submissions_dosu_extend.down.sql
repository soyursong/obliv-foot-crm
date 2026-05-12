-- rollback: form_submissions 도수센터 확장 컬럼 제거
DROP INDEX IF EXISTS idx_form_submissions_expires_at;

ALTER TABLE form_submissions
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS guardian_info;

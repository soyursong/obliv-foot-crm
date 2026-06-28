-- T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP — AC-2 rollback
-- apply(_ac2_apply.sql) 실행 후 문제 발생 시 원본 selected_keys 복원.
-- 대상 1행만 복원(jongno-foot, id ff9fd4ad…). NO-DDL.

BEGIN;

UPDATE form_submissions
SET field_data = jsonb_set(field_data, '{selected_keys}', '["oral_x", "bp_med"]'::jsonb, false)
WHERE id = 'ff9fd4ad-1f91-4923-b688-9d8f8dfb878b'
  AND status = 'draft'
  AND field_data->'selected_keys' = '["bp_med"]'::jsonb;
-- ⇒ affected rows = 1 확인 후 COMMIT. 원본 ["oral_x", "bp_med"] 복원.

COMMIT;

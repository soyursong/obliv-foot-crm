-- Rollback for T-20260423-foot-DOC-PRINT-SPEC Phase 1 seed.
DELETE FROM form_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND category = 'foot-service'
  AND form_key IN ('diag_opinion','diagnosis','bill_detail','treat_confirm','visit_confirm');

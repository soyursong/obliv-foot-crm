-- T-20260522-foot-INS-DOC-PRINT: 롤백 SQL
-- 보험서류 form_templates 시드 제거

DELETE FROM form_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND category = 'insurance'
  AND form_key = 'ins_claim_form';

-- T-20260514-foot-DOC-4FORM-IMPL — ROLLBACK
-- form_templates 4건 삭제
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8

DELETE FROM form_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key IN (
    'payment_cert',
    'referral_letter',
    'medical_record_request',
    'diag_opinion_v2'
  );

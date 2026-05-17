-- Rollback: restore original template_format values
DO $$
DECLARE v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN
  UPDATE form_templates SET template_format = 'png', template_path = '/assets/forms/foot-service/diag_opinion.png' WHERE clinic_id = v_clinic AND form_key = 'diag_opinion';
  UPDATE form_templates SET template_format = 'png', template_path = '/assets/forms/foot-service/diagnosis.png' WHERE clinic_id = v_clinic AND form_key = 'diagnosis';
  UPDATE form_templates SET template_format = 'png', template_path = '/assets/forms/foot-service/bill_detail.png' WHERE clinic_id = v_clinic AND form_key = 'bill_detail';
  UPDATE form_templates SET template_format = 'png', template_path = '/assets/forms/foot-service/treat_confirm.png' WHERE clinic_id = v_clinic AND form_key = 'treat_confirm';
  UPDATE form_templates SET template_format = 'png', template_path = '/assets/forms/foot-service/visit_confirm.png' WHERE clinic_id = v_clinic AND form_key = 'visit_confirm';
  UPDATE form_templates SET template_format = 'jpg', template_path = '/assets/forms/foot-service/rx_standard.jpg' WHERE clinic_id = v_clinic AND form_key = 'rx_standard';
  UPDATE form_templates SET template_format = 'jpg', template_path = '/assets/forms/foot-service/bill_receipt.jpg' WHERE clinic_id = v_clinic AND form_key = 'bill_receipt';
END $$;

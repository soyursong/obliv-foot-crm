-- Rollback: T-20260515-foot-FORM-TEMPLATE-REFRESH
-- 1. 기존 5종 이미지 경로·포맷 원복 (PNG → 기존 JPG/PDF)
-- 2. 신규 2종 삭제 (rx_standard, bill_receipt)
-- 3. field_map 원복은 20260506000050_field_map_phase2_seed.sql 재실행 필요

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- 기존 5종 원복
  UPDATE form_templates SET
    template_path   = '/assets/forms/foot-service/소견서.jpg',
    template_format = 'jpg'
  WHERE clinic_id = v_clinic AND form_key = 'diag_opinion';

  UPDATE form_templates SET
    template_path   = '/assets/forms/foot-service/진단서.jpg',
    template_format = 'jpg'
  WHERE clinic_id = v_clinic AND form_key = 'diagnosis';

  UPDATE form_templates SET
    template_path   = '/assets/forms/foot-service/진료비내역서.pdf',
    template_format = 'pdf'
  WHERE clinic_id = v_clinic AND form_key = 'bill_detail';

  UPDATE form_templates SET
    template_path   = '/assets/forms/foot-service/진료확인서.jpg',
    template_format = 'jpg'
  WHERE clinic_id = v_clinic AND form_key = 'treat_confirm';

  UPDATE form_templates SET
    template_path   = '/assets/forms/foot-service/통원확인서.jpg',
    template_format = 'jpg'
  WHERE clinic_id = v_clinic AND form_key = 'visit_confirm';

  -- 신규 2종 삭제
  DELETE FROM form_templates
  WHERE clinic_id = v_clinic
    AND form_key IN ('rx_standard', 'bill_receipt');

END $$;

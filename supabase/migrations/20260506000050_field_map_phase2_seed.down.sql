-- Rollback: field_map Phase 2 좌표 → 빈 배열로 초기화
DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN
  UPDATE form_templates SET field_map = '[]'::jsonb
  WHERE clinic_id = v_clinic
    AND form_key IN ('diag_opinion','diagnosis','treat_confirm','visit_confirm','bill_detail');
END $$;

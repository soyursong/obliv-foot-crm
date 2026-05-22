-- T-20260522-foot-PENCHART-FORM-AUDIT rollback
-- 20260522060000_form_templates_audit_fix.sql 롤백

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- [WARN-1] visit_confirm 45 → 40 (원래 중복 상태로 복구)
  UPDATE form_templates
  SET sort_order = 40
  WHERE clinic_id = v_clinic AND form_key = 'visit_confirm' AND sort_order = 45;

  -- [WARN-2] referral_letter 96 → 90 (원래 중복 상태로 복구)
  UPDATE form_templates
  SET sort_order = 90
  WHERE clinic_id = v_clinic AND form_key = 'referral_letter' AND sort_order = 96;

  -- [CRIT-1] refund_consent 레코드 삭제
  DELETE FROM form_templates
  WHERE clinic_id = v_clinic AND form_key = 'refund_consent';

END $$;

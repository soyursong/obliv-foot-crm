-- T-20260517-foot-FORM-SCREENSHOT-FIX
-- 서류 양식 template_format 정규화: PNG/JPG 스크린샷 → HTML/CSS
-- 이미 코드에서 isHtmlTemplate()로 HTML 렌더링 중이나 DB 레코드 불일치 수정
-- 멱등: UPDATE WHERE — 재실행 안전

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN
  -- 1. FORM-CLARITY-REWORK 5종: png → html
  UPDATE form_templates SET template_format = 'html', template_path = ''
  WHERE clinic_id = v_clinic AND form_key IN ('diag_opinion','diagnosis','bill_detail','treat_confirm','visit_confirm');

  -- 2. FORM-ONELINE-RX: rx_standard jpg → html
  UPDATE form_templates SET template_format = 'html', template_path = ''
  WHERE clinic_id = v_clinic AND form_key = 'rx_standard';

  -- 3. bill_receipt: jpg → html (FORM-SCREENSHOT-FIX 핵심 수정)
  UPDATE form_templates SET template_format = 'html', template_path = ''
  WHERE clinic_id = v_clinic AND form_key = 'bill_receipt';
END $$;

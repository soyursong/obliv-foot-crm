-- T-20260517-foot-PENCHART-FORM
-- 펜차트 양식 form_templates 시드
-- pen_chart_form.png: 현장 제공 PDF → PNG 변환 (720×1020px, A4 비율)
-- template_path: '/forms/pen_chart_form.png' (public/ 정적 파일, Vercel 서빙)
-- 멱등: INSERT ... ON CONFLICT DO UPDATE

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'pen_chart',
    '펜차트 양식',
    '/forms/pen_chart_form.png',
    'png',
    '[]'::jsonb,
    false,
    'admin|manager|coordinator|director',
    true,
    90
  )
  ON CONFLICT (clinic_id, form_key)
  DO UPDATE SET
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    name_ko         = EXCLUDED.name_ko,
    active          = true;
END $$;

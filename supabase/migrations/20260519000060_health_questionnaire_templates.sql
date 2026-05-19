-- T-20260519-foot-HEALTH-Q-PEN
-- 발건강 질문지 양식 2종 추가 (일반용 + 어르신용)
-- PDF → PNG 변환 후 캔버스 배경으로 사용. 태블릿펜 필기 입력 방식.
-- 기존 personal_checklist_* 텍스트 입력 방식 → 이 양식으로 전환
--
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)
-- template_format: 'png' — 캔버스 배경 이미지 (public/forms/ 정적 에셋)
-- template_path: /forms/health_q_general.png | /forms/health_q_senior.png
-- 멱등: ON CONFLICT DO UPDATE — 재실행 안전
--
-- 롤백:
--   DELETE FROM form_templates
--   WHERE form_key IN ('health_questionnaire_general', 'health_questionnaire_senior')
--     AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 1) 발건강 질문지 (일반용) — health_questionnaire_general
  --    PDF 원본: 오블리브(오리진)_발톱_첫방문 발건강 질문지.pdf (F0B4QEJRW4S)
  --    PNG 변환: public/forms/health_q_general.png (150dpi, 1241×1754)
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'health_questionnaire_general',
    '발건강 질문지 (일반)',
    '/forms/health_q_general.png',
    'png',
    '[]'::jsonb,
    false,
    'admin|manager|coordinator|director',
    true,
    91
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;

  -- ────────────────────────────────────────────────────────────────
  -- 2) 발건강 질문지 (어르신용) — health_questionnaire_senior
  --    PDF 원본: 오블리브(오리진)_발톱_첫방문 발건강 질문지(어르신용).pdf (F0B4U3234P6)
  --    PNG 변환: public/forms/health_q_senior.png (150dpi, 1241×1754)
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'health_questionnaire_senior',
    '발건강 질문지 (어르신용)',
    '/forms/health_q_senior.png',
    'png',
    '[]'::jsonb,
    false,
    'admin|manager|coordinator|director',
    true,
    92
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    name_ko         = EXCLUDED.name_ko,
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active,
    sort_order      = EXCLUDED.sort_order;

  -- personal_checklist_* sort_order 를 뒤로 밀어 UI 하단에 레거시 표시
  UPDATE form_templates
  SET sort_order = sort_order + 10
  WHERE clinic_id = v_clinic
    AND form_key IN ('personal_checklist_general', 'personal_checklist_senior');

END $$;

-- T-20260519-foot-PENCHART-FORM-ADD
-- 개인정보+체크리스트 합본 양식 2종 추가 (일반용 + 어르신용)
-- 고객 직접 기입 모드 (태블릿 텍스트 입력 필드)
-- 저장 시 form_submissions.check_in_id 자동 연동
--
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)
-- template_format: 'html' — 캔버스 없이 인앱 렌더링 (기존 html 포맷 확장)
-- 멱등: ON CONFLICT DO UPDATE — 재실행 안전
--
-- 롤백:
--   DELETE FROM form_templates
--   WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior')
--     AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 1) 개인정보+체크리스트 (일반용) — personal_checklist_general
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'personal_checklist_general',
    '개인정보+체크리스트 (일반)',
    '',
    'html',
    '[
      {"key":"name",                 "label":"성명",           "type":"text",     "x":0,"y":0},
      {"key":"phone",                "label":"연락처",         "type":"text",     "x":0,"y":0},
      {"key":"birth_date",           "label":"생년월일",       "type":"date",     "x":0,"y":0},
      {"key":"address",              "label":"주소",           "type":"text",     "x":0,"y":0},
      {"key":"symptoms",             "label":"발 증상",        "type":"checkbox", "x":0,"y":0,
        "options":["굳은살/티눈","무좀","내성발톱","발냄새","발건조/각질","당뇨발/혈액순환","기타"]},
      {"key":"symptoms_other",       "label":"기타 증상",      "type":"text",     "x":0,"y":0},
      {"key":"pain_areas",           "label":"통증 부위",      "type":"checkbox", "x":0,"y":0,
        "options":["발앞꿈치","발뒤꿈치","발바닥","발등","발목"]},
      {"key":"medical_history",      "label":"과거병력",       "type":"checkbox", "x":0,"y":0,
        "options":["당뇨","고혈압","심장질환","혈액순환장애","기타"]},
      {"key":"medical_history_other","label":"기타 병력",      "type":"text",     "x":0,"y":0},
      {"key":"has_allergy",          "label":"알레르기 여부",  "type":"boolean",  "x":0,"y":0},
      {"key":"allergy_detail",       "label":"알레르기 내역",  "type":"text",     "x":0,"y":0},
      {"key":"agree_privacy",        "label":"개인정보 동의",  "type":"boolean",  "x":0,"y":0},
      {"key":"agree_marketing",      "label":"마케팅 동의",    "type":"boolean",  "x":0,"y":0}
    ]'::jsonb,
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
  -- 2) 개인정보+체크리스트 (어르신용) — personal_checklist_senior
  --    동일 필드 구조 / UI에서 글씨 크기↑ + 입력 필드 확대
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'personal_checklist_senior',
    '개인정보+체크리스트 (어르신)',
    '',
    'html',
    '[
      {"key":"name",                 "label":"성명",           "type":"text",     "x":0,"y":0},
      {"key":"phone",                "label":"연락처",         "type":"text",     "x":0,"y":0},
      {"key":"birth_date",           "label":"생년월일",       "type":"date",     "x":0,"y":0},
      {"key":"address",              "label":"주소",           "type":"text",     "x":0,"y":0},
      {"key":"symptoms",             "label":"발 증상",        "type":"checkbox", "x":0,"y":0,
        "options":["굳은살/티눈","무좀","내성발톱","발냄새","발건조/각질","당뇨발/혈액순환","기타"]},
      {"key":"symptoms_other",       "label":"기타 증상",      "type":"text",     "x":0,"y":0},
      {"key":"pain_areas",           "label":"통증 부위",      "type":"checkbox", "x":0,"y":0,
        "options":["발앞꿈치","발뒤꿈치","발바닥","발등","발목"]},
      {"key":"medical_history",      "label":"과거병력",       "type":"checkbox", "x":0,"y":0,
        "options":["당뇨","고혈압","심장질환","혈액순환장애","기타"]},
      {"key":"medical_history_other","label":"기타 병력",      "type":"text",     "x":0,"y":0},
      {"key":"has_allergy",          "label":"알레르기 여부",  "type":"boolean",  "x":0,"y":0},
      {"key":"allergy_detail",       "label":"알레르기 내역",  "type":"text",     "x":0,"y":0},
      {"key":"agree_privacy",        "label":"개인정보 동의",  "type":"boolean",  "x":0,"y":0},
      {"key":"agree_marketing",      "label":"마케팅 동의",    "type":"boolean",  "x":0,"y":0}
    ]'::jsonb,
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

END $$;

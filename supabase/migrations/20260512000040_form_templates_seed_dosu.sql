-- T-20260423-foot-DOSU-FORMS-SPEC Phase 0 — form_templates seed (dosu-center 10종)
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   현재는 풋센터 종로 ID를 임시 사용. 도수센터 오픈 시 별도 clinic row 생성 후 clinic_id 업데이트.
-- template_format: png (도수센터 에셋은 모두 PNG)
-- field_map: 빈 배열 — 도수센터 오픈 후 현장 측정 예정
-- required_role: 티켓 스펙(2026-04-23) 기준
-- requires_signature: 서명 필요 서류 플래그
-- minor_consent의 field_map: 복수 서명자 signature_slots 구조 포함
-- 멱등: ON CONFLICT (clinic_id, form_key) DO UPDATE

INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko,
  template_path, template_format, field_map,
  requires_signature, required_role, active, sort_order
) VALUES

  -- ── 치료 동의서 (coordinator+) ──
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'dosu_consent',
    '도수치료 동의서',
    '/assets/forms/도수센터/[도수센터]도수치료 동의서.png',
    'png',
    '[]'::jsonb,
    true,
    'coordinator|manager|admin',
    true,
    10
  ),

  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'general_consent',
    '동의서',
    '/assets/forms/도수센터/[도수센터]동의서.png',
    'png',
    '[]'::jsonb,
    true,
    'coordinator|manager|admin',
    true,
    20
  ),

  -- 미성년자 동의서: 환자+법정대리인 복수 서명 슬롯
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'minor_consent',
    '미성년자 시술 동의서',
    '/assets/forms/도수센터/[도수센터]미성년자 시술 동의서.png',
    'png',
    '[
      {"key":"signer_patient",  "label":"환자 서명",       "type":"text","x":0,"y":0},
      {"key":"signer_guardian", "label":"법정대리인 서명", "type":"text","x":0,"y":0}
    ]'::jsonb,
    true,
    'coordinator|manager|admin',
    true,
    30
  ),

  -- ── 결제 서류 (coordinator+) ──
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'nonbenefit_explain',
    '비급여 설명확인서',
    '/assets/forms/도수센터/[도수센터]비급여 설명확인서.png',
    'png',
    '[]'::jsonb,
    true,
    'coordinator|manager|admin',
    true,
    40
  ),

  -- ── 문진 서류 (서명 불필요, coordinator+) ──
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'growth_hormone_survey',
    '성장호르몬 설문지',
    '/assets/forms/도수센터/[도수센터]성장호르몬 설문지.png',
    'png',
    '[]'::jsonb,
    false,
    'coordinator|manager|admin',
    true,
    50
  ),

  -- ── 마케팅 서류 (admin|manager 한정) ──
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'model_contract_1',
    '모델 계약서 1',
    '/assets/forms/도수센터/[도수센터]모델 계약서_1.png',
    'png',
    '[]'::jsonb,
    true,
    'admin|manager',
    true,
    60
  ),

  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'model_contract_2',
    '모델 계약서 2',
    '/assets/forms/도수센터/[도수센터]모델계약서_2.png',
    'png',
    '[]'::jsonb,
    true,
    'admin|manager',
    true,
    70
  ),

  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'experience_portrait',
    '체험단 초상권동의서',
    '/assets/forms/도수센터/[도수센터]체험단 초상권동의서.png',
    'png',
    '[]'::jsonb,
    true,
    'admin|manager',
    true,
    80
  ),

  -- ── 진료기록 서류 (therapist+, draft 편집 가능) ──
  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'initial_chart',
    '초진차트',
    '/assets/forms/도수센터/[도수센터]초진차트.png',
    'png',
    '[]'::jsonb,
    false,
    'therapist|coordinator|manager|admin',
    true,
    90
  ),

  (
    '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    'dosu-center',
    'row_chart',
    '줄차트',
    '/assets/forms/도수센터/[도수센터]줄차트.png',
    'png',
    '[]'::jsonb,
    false,
    'therapist|coordinator|manager|admin',
    true,
    100
  )

ON CONFLICT (clinic_id, form_key) DO UPDATE SET
  name_ko            = EXCLUDED.name_ko,
  template_path      = EXCLUDED.template_path,
  template_format    = EXCLUDED.template_format,
  field_map          = EXCLUDED.field_map,
  required_role      = EXCLUDED.required_role,
  requires_signature = EXCLUDED.requires_signature,
  sort_order         = EXCLUDED.sort_order;

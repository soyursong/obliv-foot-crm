-- T-20260515-foot-FORM-TEMPLATE-REFRESH
-- 풋센터 서류 양식 7종 전량 등록
--   1. 기존 5종 이미지 경로·포맷 갱신 (JPG/PDF → PNG)
--   2. 기존 5종 field_map 좌표 갱신 (새 이미지 해상도 반영)
--   3. rx_standard (처방전, 표준처방전) 신규 등록
--   4. bill_receipt (진료비 계산서·영수증) 신규 등록
--
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)
-- 관련 에셋: src/assets/forms/foot-service/{form_key}.{png|jpg}
--
-- ⚠ 좌표는 초기 추정치 — 원장 인쇄 미리보기 시각 검증 후 UPDATE로 세부 조정 예정
-- 멱등: ON CONFLICT DO UPDATE — 재실행 안전

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 1) 소견서 (diag_opinion) — 신규 PNG 645×884 px
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET
    template_path   = '/assets/forms/foot-service/diag_opinion.png',
    template_format = 'png',
    field_map = '[
      {"key":"patient_name","label":"환자성명","type":"text",      "x":130,"y":138,"font":14},
      {"key":"patient_rrn", "label":"주민번호","type":"text",      "x":272,"y":103,"font":12},
      {"key":"diagnosis_ko","label":"상병명",  "type":"multiline","x":200,"y":186,"w":400,"h":55,"font":13},
      {"key":"issue_date",  "label":"발행일",  "type":"date",      "x":130,"y":718,"font":13},
      {"key":"clinic_name", "label":"의료기관","type":"text",      "x":105,"y":742,"font":12},
      {"key":"doctor_name", "label":"의사성명","type":"text",      "x":480,"y":877,"font":13}
    ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'diag_opinion';

  -- ────────────────────────────────────────────────────────────────
  -- 2) 진단서 (diagnosis) — 신규 PNG 621×835 px
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET
    template_path   = '/assets/forms/foot-service/diagnosis.png',
    template_format = 'png',
    field_map = '[
      {"key":"patient_name","label":"환자성명",    "type":"text",      "x":118,"y":136,"font":14},
      {"key":"patient_rrn", "label":"주민등록번호","type":"text",      "x":390,"y":136,"font":12},
      {"key":"diagnosis_ko","label":"병명",        "type":"multiline","x":195,"y":193,"w":380,"h":50,"font":13},
      {"key":"issue_date",  "label":"발행일",      "type":"date",      "x":170,"y":632,"font":13},
      {"key":"clinic_name", "label":"의료기관",    "type":"text",      "x":100,"y":650,"font":12},
      {"key":"doctor_name", "label":"의사성명",    "type":"text",      "x":470,"y":812,"font":13}
    ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'diagnosis';

  -- ────────────────────────────────────────────────────────────────
  -- 3) 진료비내역서 (bill_detail) — PDF → 신규 PNG 1123×789 px (가로형)
  --    ⚠ 포맷 변경: pdf → png. CSS 좌표계(좌상단 원점, 픽셀)로 전환.
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET
    template_path   = '/assets/forms/foot-service/bill_detail.png',
    template_format = 'png',
    field_map = '[
      {"key":"patient_name","label":"환자성명",    "type":"text",  "x":200,"y":90, "font":13},
      {"key":"issue_date",  "label":"발행일",      "type":"date",  "x":500,"y":475,"font":13},
      {"key":"total_amount","label":"합계금액",    "type":"amount","x":750,"y":428,"font":12},
      {"key":"clinic_name", "label":"요양기관명",  "type":"text",  "x":205,"y":500,"font":12}
    ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'bill_detail';

  -- ────────────────────────────────────────────────────────────────
  -- 4) 진료확인서 (treat_confirm) — 신규 PNG 693×907 px (빈 양식)
  --    ⚠ 구 이미지(1272×1638) 대비 ~0.545배 축소 — 좌표 재계산
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET
    template_path   = '/assets/forms/foot-service/treat_confirm.png',
    template_format = 'png',
    field_map = '[
      {"key":"patient_name","label":"환자성명","type":"text",      "x":130,"y":163,"font":16},
      {"key":"patient_rrn", "label":"주민번호","type":"text",      "x":130,"y":187,"font":14},
      {"key":"diagnosis_ko","label":"병명",    "type":"multiline","x":140,"y":218,"w":520,"h":50,"font":14},
      {"key":"issue_date",  "label":"발행일",  "type":"date",      "x":130,"y":790,"font":16},
      {"key":"clinic_name", "label":"의료기관","type":"text",      "x":130,"y":812,"font":14},
      {"key":"doctor_name", "label":"의사성명","type":"text",      "x":560,"y":900,"font":14}
    ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'treat_confirm';

  -- ────────────────────────────────────────────────────────────────
  -- 5) 통원확인서 (visit_confirm) — 신규 PNG 639×800 px
  --    (구 637×800과 거의 동일 — 미세 조정)
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET
    template_path   = '/assets/forms/foot-service/visit_confirm.png',
    template_format = 'png',
    field_map = '[
      {"key":"patient_name","label":"환자성명","type":"text",      "x":128,"y":153,"font":14},
      {"key":"patient_rrn", "label":"주민번호","type":"text",      "x":120,"y":174,"font":12},
      {"key":"diagnosis_ko","label":"병명",    "type":"multiline","x":140,"y":205,"w":450,"h":50,"font":13},
      {"key":"issue_date",  "label":"발행일",  "type":"date",      "x":120,"y":692,"font":13},
      {"key":"clinic_name", "label":"의료기관","type":"text",      "x":120,"y":710,"font":12},
      {"key":"doctor_name", "label":"의사성명","type":"text",      "x":540,"y":793,"font":13}
    ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'visit_confirm';

  -- ────────────────────────────────────────────────────────────────
  -- 6) 신규: 처방전 (rx_standard) — JPG 1206×1735 px
  --    T-20260423-foot-RX-CODE-SEED에서 form_key 예약됨.
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'rx_standard',
    '처방전(표준처방전)',
    '/assets/forms/foot-service/rx_standard.jpg', 'jpg',
    '[
      {"key":"patient_name","label":"피보성명(환자성명)","type":"text","x":155,"y":345,"font":18},
      {"key":"patient_rrn", "label":"주민번호",          "type":"text","x":155,"y":388,"font":16},
      {"key":"diagnosis_ko","label":"질병분류기호",      "type":"text","x":30, "y":455,"font":16},
      {"key":"issue_date",  "label":"교부일",            "type":"date","x":155,"y":313,"font":16},
      {"key":"clinic_name", "label":"의료기관명칭",      "type":"text","x":705,"y":313,"font":16},
      {"key":"doctor_name", "label":"처방의사성명",      "type":"text","x":570,"y":455,"font":16}
    ]'::jsonb,
    false, 'admin|manager|director', true, 15
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    name_ko         = EXCLUDED.name_ko,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active;

  -- ────────────────────────────────────────────────────────────────
  -- 7) 신규: 진료비 계산서·영수증 (bill_receipt) — JPG 1206×1779 px
  --    완전 신규. form_templates INSERT + field_map 초기 작성.
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format, field_map,
    requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic, 'foot-service', 'bill_receipt',
    '진료비 계산서·영수증',
    '/assets/forms/foot-service/bill_receipt.jpg', 'jpg',
    '[
      {"key":"patient_name","label":"환자성명",    "type":"text",  "x":200,"y":65,  "font":16},
      {"key":"total_amount","label":"총진료비",    "type":"amount","x":950,"y":218, "font":14},
      {"key":"issue_date",  "label":"발행일",      "type":"date",  "x":230,"y":1496,"font":14},
      {"key":"clinic_name", "label":"요양기관명칭","type":"text",  "x":400,"y":1461,"font":14}
    ]'::jsonb,
    false, 'admin|manager|coordinator', true, 35
  )
  ON CONFLICT (clinic_id, form_key) DO UPDATE SET
    template_path   = EXCLUDED.template_path,
    template_format = EXCLUDED.template_format,
    name_ko         = EXCLUDED.name_ko,
    field_map       = EXCLUDED.field_map,
    required_role   = EXCLUDED.required_role,
    active          = EXCLUDED.active;

END $$;

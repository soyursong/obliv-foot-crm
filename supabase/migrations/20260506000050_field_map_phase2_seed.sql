-- T-20260430-foot-DOC-PRINT-FOLLOWUP Phase 2
-- field_map 좌표 시드 — 5종 (JPG 4 + PDF 1)
--
-- 좌표 기준:
--   JPG — CSS position:absolute (픽셀, 좌상단 원점, 원본 이미지 해상도 기준)
--   PDF — pdf-lib drawText (포인트, 좌하단 원점, A4 595×842pt)
--
-- ⚠ 본 좌표는 이미지 계측 초기 추정치입니다.
--   문지은 원장 인쇄 미리보기 시각 검증 후 필요 시 UPDATE로 세부 조정 예정.
--
-- 이미지 해상도:
--   소견서.jpg     636×884 px
--   진단서.jpg     612×820 px
--   진료확인서.jpg 1272×1638 px  (고해상도 스캔)
--   통원확인서.jpg 637×800 px
--   진료비내역서.pdf A4 595×842 pt (pdf-lib 좌표계)
--
-- 멱등: WHERE 절로 해당 행만 업데이트 — 재실행 안전

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 1) 소견서 (diag_opinion) — 636×884 px
  --    주요 행: 환자성명 y≈103 / 주민번호(헤더) y≈62 / 상병명 y≈163
  --             발행일 y≈672 / 의료기관 y≈692 / 의사성명 y≈840
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET field_map = '[
    {"key":"patient_name",  "label":"환자성명",  "type":"text",      "x":108, "y":103, "font":14},
    {"key":"patient_rrn",   "label":"주민번호",  "type":"text",      "x":272, "y":62,  "font":12},
    {"key":"diagnosis_ko",  "label":"상병명",    "type":"multiline", "x":108, "y":163, "w":400, "h":55, "font":13},
    {"key":"issue_date",    "label":"발행일",    "type":"date",      "x":115, "y":672, "font":13},
    {"key":"clinic_name",   "label":"의료기관",  "type":"text",      "x":115, "y":692, "font":12},
    {"key":"doctor_name",   "label":"의사성명",  "type":"text",      "x":490, "y":840, "font":13}
  ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'diag_opinion';

  -- ────────────────────────────────────────────────────────────────
  -- 2) 진단서 (diagnosis) — 612×820 px
  --    주요 행: 환자성명 y≈95 / 주민등록번호(동행 우측) x≈390,y≈95
  --             병명 y≈143 / 발행일 y≈558 / 의료기관 y≈578
  --             의사성명 y≈770
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET field_map = '[
    {"key":"patient_name",  "label":"환자성명",      "type":"text",      "x":118, "y":95,  "font":14},
    {"key":"patient_rrn",   "label":"주민등록번호",   "type":"text",      "x":390, "y":95,  "font":12},
    {"key":"diagnosis_ko",  "label":"병명",          "type":"multiline", "x":110, "y":143, "w":395, "h":50, "font":13},
    {"key":"issue_date",    "label":"발행일",        "type":"date",      "x":110, "y":558, "font":13},
    {"key":"clinic_name",   "label":"의료기관",      "type":"text",      "x":110, "y":578, "font":12},
    {"key":"doctor_name",   "label":"의사성명",      "type":"text",      "x":548, "y":770, "font":13}
  ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'diagnosis';

  -- ────────────────────────────────────────────────────────────────
  -- 3) 진료확인서 (treat_confirm) — 1272×1638 px (고해상도 ×2배)
  --    주요 행: 환자성명 y≈172 / 주민번호 y≈207 / 병명 y≈242
  --             발행일 y≈1100 / 의료기관 y≈1178 / 의사성명 y≈1575
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET field_map = '[
    {"key":"patient_name",  "label":"환자성명",  "type":"text",      "x":220,  "y":172,  "font":20},
    {"key":"patient_rrn",   "label":"주민번호",  "type":"text",      "x":220,  "y":207,  "font":18},
    {"key":"diagnosis_ko",  "label":"병명",      "type":"multiline", "x":160,  "y":242,  "w":900, "h":80, "font":16},
    {"key":"issue_date",    "label":"발행일",    "type":"date",      "x":195,  "y":1100, "font":18},
    {"key":"clinic_name",   "label":"의료기관",  "type":"text",      "x":195,  "y":1178, "font":16},
    {"key":"doctor_name",   "label":"의사성명",  "type":"text",      "x":1145, "y":1575, "font":18}
  ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'treat_confirm';

  -- ────────────────────────────────────────────────────────────────
  -- 4) 통원확인서 (visit_confirm) — 637×800 px
  --    주요 행: 환자성명 y≈133 / 주민번호 y≈156 / 병명 y≈177
  --             발행일 y≈640 / 의료기관 y≈660 / 의사성명 y≈750
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET field_map = '[
    {"key":"patient_name",  "label":"환자성명",  "type":"text",      "x":108, "y":133, "font":14},
    {"key":"patient_rrn",   "label":"주민번호",  "type":"text",      "x":108, "y":156, "font":12},
    {"key":"diagnosis_ko",  "label":"병명",      "type":"multiline", "x":108, "y":177, "w":400, "h":50, "font":13},
    {"key":"issue_date",    "label":"발행일",    "type":"date",      "x":105, "y":640, "font":13},
    {"key":"clinic_name",   "label":"의료기관",  "type":"text",      "x":105, "y":660, "font":12},
    {"key":"doctor_name",   "label":"의사성명",  "type":"text",      "x":555, "y":750, "font":13}
  ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'visit_confirm';

  -- ────────────────────────────────────────────────────────────────
  -- 5) 진료비내역서 (bill_detail) — PDF A4 595×842pt (좌하단 원점)
  --    pdf-lib drawText 좌표계: y는 아래서 위로 증가
  --    주요 영역: 환자성명/발행일 y≈788 (상단) / 합계금액 y≈145 / 기관명 y≈58
  --    ⚠ PDF 좌표는 실제 진료비내역서.pdf 레이아웃 확인 후 세부 조정 필수
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET field_map = '[
    {"key":"patient_name",  "label":"환자성명",  "type":"text",   "x":140, "y":788, "font":11},
    {"key":"issue_date",    "label":"발행일",    "type":"date",   "x":420, "y":788, "font":11},
    {"key":"total_amount",  "label":"합계금액",  "type":"amount", "x":440, "y":145, "font":12},
    {"key":"clinic_name",   "label":"기관명",    "type":"text",   "x":140, "y":58,  "font":10}
  ]'::jsonb
  WHERE clinic_id = v_clinic AND form_key = 'bill_detail';

END $$;

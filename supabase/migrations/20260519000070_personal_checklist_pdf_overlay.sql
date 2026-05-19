-- T-20260519-foot-PENCHART-FORM-ADD (FIX-REQUEST: pdf_overlay 전환)
-- personal_checklist_* template_format: 'html' → 'pdf_overlay'
-- template_path 업데이트: PDF → PNG 변환 파일 경로
--
-- 배경: 김주연 매니저 5/19 17:17 요청
--   "개인정보/체크리스트 클릭 시 PDF 원본으로 열리게, 태블릿펜으로 기입·저장"
--   기존 html(텍스트 입력 폼) → PDF 원본 배경 + 태블릿펜 캔버스 방식으로 전환
--
-- PDF 원본:
--   일반용(1p): 첫방문 발건강 질문지.pdf (F0B4QEJRW4S)
--   어르신용(2p): 첫방문 발건강 질문지(어르신용).pdf (F0B4U3234P6)
-- PNG 변환:
--   public/forms/personal_checklist_general.png (150dpi, 1241×1754)
--   public/forms/personal_checklist_senior.png  (150dpi, 1241×3508, 2페이지 세로 연결)
--
-- Step 1: form_templates_template_format_check constraint에 'pdf_overlay' 추가
-- Step 2: template_path + template_format 업데이트
--
-- 롤백:
--   20260519000070_personal_checklist_pdf_overlay.down.sql 참조

-- ── Step 1: CHECK constraint 확장 ('pdf_overlay' 추가) ────────────────────────
ALTER TABLE form_templates
  DROP CONSTRAINT IF EXISTS form_templates_template_format_check;

ALTER TABLE form_templates
  ADD CONSTRAINT form_templates_template_format_check
  CHECK (template_format = ANY (ARRAY[
    'jpg'::text,
    'png'::text,
    'pdf'::text,
    'html'::text,
    'pdf_overlay'::text
  ]));

-- ── Step 2: personal_checklist 행 업데이트 ────────────────────────────────────
DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- 1) 일반용: template_path + template_format 업데이트
  UPDATE form_templates
  SET
    template_path   = '/forms/personal_checklist_general.png',
    template_format = 'pdf_overlay',
    name_ko         = '개인정보+체크리스트 (일반)',
    sort_order      = 91
  WHERE clinic_id = v_clinic
    AND form_key   = 'personal_checklist_general';

  -- 2) 어르신용: template_path + template_format 업데이트 (2페이지 세로 연결 PNG)
  UPDATE form_templates
  SET
    template_path   = '/forms/personal_checklist_senior.png',
    template_format = 'pdf_overlay',
    name_ko         = '개인정보+체크리스트 (어르신용)',
    sort_order      = 92
  WHERE clinic_id = v_clinic
    AND form_key   = 'personal_checklist_senior';

END $$;

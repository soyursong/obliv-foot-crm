-- T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX 2
-- form_submissions.template_id DROP NOT NULL
--
-- 배경:
--   PenChartTab에서 builtin 템플릿(발건강 질문지 등) 저장 시 template_id를 payload에 미포함.
--   (builtin ID는 form_templates FK 없음 — FK 위반 방지)
--   기존 NOT NULL 제약으로 INSERT가 무성 실패 → 상담내역 [내용보기] 버튼 비활성 지속.
--
-- 수정:
--   template_id를 NULL 허용으로 변경.
--   field_data.form_key 폴백으로 template_key 추론 (FE 기존 코드 그대로 동작).
--
-- 적용 범위: public.form_submissions
-- 롤백: 20260521090000_form_submissions_template_id_nullable.down.sql

ALTER TABLE form_submissions ALTER COLUMN template_id DROP NOT NULL;

COMMENT ON COLUMN form_submissions.template_id IS
  'form_templates FK. NULL 허용 — builtin 템플릿(발건강 질문지·펜차트 기본 양식 등)은
   form_templates 레코드가 없으므로 NULL. template_key는 field_data.form_key로 추론.
   T-20260521 PENCHART-VIEW-SPLIT HOTFIX2 수정.';

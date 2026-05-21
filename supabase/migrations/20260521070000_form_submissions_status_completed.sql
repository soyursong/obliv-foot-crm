-- T-20260520-foot-PENCHART-VIEW-SPLIT REOPEN
-- form_submissions.status CHECK constraint에 'completed' 추가
--
-- 배경:
--   PenChartTab handleDrawSave에서 health_questionnaire_* 저장 시 status='completed'를 사용.
--   기존 CHECK constraint에 'completed'가 없어 INSERT가 무성 실패(swallowed error).
--   FE는 status='signed'로 수정하였으나, DB 측도 'completed'를 허용해 안전망 확보.
--
-- 적용 범위: public.form_submissions
-- 멱등: DO $$로 constraint 존재 여부 확인 후 DROP/ADD
--
-- 롤백: 20260521070000_form_submissions_status_completed.down.sql

DO $$
BEGIN
  -- 기존 constraint 이름 확인 후 DROP
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'form_submissions'
      AND constraint_name LIKE '%status%'
  ) THEN
    -- constraint 이름이 'form_submissions_status_check'인 경우
    ALTER TABLE form_submissions
      DROP CONSTRAINT IF EXISTS form_submissions_status_check;
  END IF;
END $$;

-- 새 CHECK constraint — 'completed' 추가
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_status_check
  CHECK (status IN ('draft', 'printed', 'signed', 'voided', 'completed'));

COMMENT ON COLUMN form_submissions.status IS
  'form_submissions 처리 상태.
   draft: 작성중, printed: 출력됨, signed: 서명완료, voided: 무효,
   completed: 서명 불필요 양식 완료 (발건강 질문지 등 캔버스 필기 방식).
   T-20260521 PENCHART-VIEW-SPLIT REOPEN 수정으로 추가.';

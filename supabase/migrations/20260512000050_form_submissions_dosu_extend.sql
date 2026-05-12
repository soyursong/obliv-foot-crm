-- T-20260423-foot-DOSU-FORMS-SPEC — form_submissions 스키마 확장
-- 도수센터 마케팅 서류 만료일 + 미성년자 보호자 정보
-- 대표 승인: 2026-05-11 (도수 CRM 킥오프 직접 지시)
-- 멱등: ADD COLUMN IF NOT EXISTS

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS guardian_info JSONB       DEFAULT NULL;

COMMENT ON COLUMN form_submissions.expires_at IS
  '마케팅 서류(모델계약서·체험단 초상권) 만료일. NULL이면 만료 없음.';

COMMENT ON COLUMN form_submissions.guardian_info IS
  '미성년자 동의서 법정대리인 정보 JSONB.
   스키마: {
     "guardian_name":     string,   -- 보호자 성명
     "guardian_rrn":      string,   -- 보호자 주민번호 (앞자리-뒷자리 or 암호화)
     "guardian_relation": string,   -- 관계 (부|모|조부모|...)
     "guardian_phone":    string    -- 보호자 연락처 E.164
   }';

-- 마케팅 서류 만료일 인덱스 (만료 알림 쿼리 대비)
CREATE INDEX IF NOT EXISTS idx_form_submissions_expires_at
  ON form_submissions(clinic_id, expires_at)
  WHERE expires_at IS NOT NULL;

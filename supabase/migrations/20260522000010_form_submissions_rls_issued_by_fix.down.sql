-- ROLLBACK: 20260522000010_form_submissions_rls_issued_by_fix.sql

-- 새 RLS 정책 제거
DROP POLICY IF EXISTS "form_submissions_read"   ON form_submissions;
DROP POLICY IF EXISTS "form_submissions_insert"  ON form_submissions;
DROP POLICY IF EXISTS "form_submissions_update"  ON form_submissions;

-- 원래 RLS 정책 복원 (staff.user_id 기반 — 주의: 원래대로 차단됨)
CREATE POLICY "form_submissions_read" ON form_submissions
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "form_submissions_insert" ON form_submissions
  FOR INSERT WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "form_submissions_update" ON form_submissions
  FOR UPDATE USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- issued_by NOT NULL 복원 (데이터가 있으면 실패할 수 있음)
ALTER TABLE form_submissions ALTER COLUMN issued_by SET NOT NULL;

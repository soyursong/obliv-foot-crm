-- T-20260520-foot-PENCHART-VIEW-SPLIT REOPEN3 근본 원인 수정
-- form_submissions: issued_by nullable + RLS user_profiles 기반으로 교체
--
-- 근본 원인:
--   1) issued_by UUID NOT NULL → staffId null이면 INSERT FK 위반
--   2) RLS 정책이 staff.user_id = auth.uid()를 사용하지만 staff.user_id 전원 null
--      → 모든 사용자의 INSERT/SELECT 완전 차단
--   3) 코드 레벨 if (staffId) 게이트 → INSERT 블록 자체를 실행하지 않음
--   → form_submissions 레코드 0건, [내용보기] 버튼 영구 비활성
--
-- 수정:
--   1) issued_by DROP NOT NULL
--   2) 기존 RLS (staff 기반) → user_profiles 기반으로 교체
--      clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid() AND active = true)
--
-- 롤백: 20260522000010_form_submissions_rls_issued_by_fix.down.sql
-- 검증: service key로 form_submissions INSERT → anon key로 SELECT 확인

-- Step 1: issued_by nullable
ALTER TABLE form_submissions ALTER COLUMN issued_by DROP NOT NULL;

COMMENT ON COLUMN form_submissions.issued_by IS
  'form_submissions 작성 직원 FK (staff.id). NULL 허용 —
   user_id 없는 환경(staff.user_id=null)에서도 저장 가능하도록.
   T-20260522 PENCHART-VIEW-SPLIT REOPEN3 수정.';

-- Step 2: 기존 RLS 정책 제거 (staff.user_id 기반)
DROP POLICY IF EXISTS "form_submissions_read"   ON form_submissions;
DROP POLICY IF EXISTS "form_submissions_insert"  ON form_submissions;
DROP POLICY IF EXISTS "form_submissions_update"  ON form_submissions;

-- Step 3: 새 RLS 정책 (user_profiles 기반)
CREATE POLICY "form_submissions_read" ON form_submissions
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

CREATE POLICY "form_submissions_insert" ON form_submissions
  FOR INSERT WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

CREATE POLICY "form_submissions_update" ON form_submissions
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

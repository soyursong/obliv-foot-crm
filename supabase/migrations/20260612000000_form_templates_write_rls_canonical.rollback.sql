-- ROLLBACK: T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER (WS-1)
-- 20260612000000_form_templates_write_rls_canonical.sql 원복.
-- ⚠ 적용 시 write OUTLIER(비정규 staff.user_id 신원 + 역할 무필터 과대권한) 재발 — 긴급 회복용만.
-- 라이브 원상태(2개 정책)로 복원: form_templates_manage(FOR ALL, staff.user_id) + form_templates_read(SELECT true) 유지.

BEGIN;

-- canonical write 제거
DROP POLICY IF EXISTS form_templates_admin_all ON form_templates;

-- 구 OUTLIER write 정책 복원 (20260422000000 원형)
DROP POLICY IF EXISTS form_templates_manage ON form_templates;
CREATE POLICY form_templates_manage ON form_templates
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_id FROM staff WHERE user_id = auth.uid())
  );

-- form_templates_read [SELECT] USING(true) 는 본 티켓에서 미접촉 → 원복 불필요(그대로 존재).

COMMIT;

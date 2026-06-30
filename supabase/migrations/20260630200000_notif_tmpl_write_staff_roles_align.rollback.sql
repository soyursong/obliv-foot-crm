-- ROLLBACK: T-20260630-foot-NOTIF-TMPL-RLS-CODY-UNLOCK
-- ============================================================================
-- notif_tmpl_write + notif_optout_write RLS 를 본 티켓 이전(3역할) 상태로 복원한다.
--   복원 대상 = 20260525030000_messaging_module.sql 의 원본 정책
--               (clinic_id isolation + get_user_role() IN ('admin','manager','director')).
--   ★주의★: ADDITIVE 확대였으므로 롤백 = consultant/coordinator/therapist/part_lead/staff 의
--           템플릿·수신거부 저장 권한 회수 → coordinator 등은 다시 "저장 권한 없음" 에러(의도된 되돌림).
--   clinic_id isolation INVARIANT 은 복원본에서도 동일 유지(USING + WITH CHECK 양쪽).
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS notif_tmpl_write ON public.notification_templates;
CREATE POLICY notif_tmpl_write ON public.notification_templates
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  );

DROP POLICY IF EXISTS notif_optout_write ON public.notification_opt_outs;
CREATE POLICY notif_optout_write ON public.notification_opt_outs
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  );

COMMIT;

-- ROLLBACK: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G2 (clinic_events)
-- 20260611160000_clinic_events_select_rls_canonical.sql 의 역적용.
-- clinic_events SELECT 정책을 원래의 비정규(staff.id=auth.uid()) 술어로 복원.
--
-- 주의: 롤백 시 G2 outlier 버그 재발 — ClinicCalendar 가 직원·관리자 거의 전원에게
--        일정 이벤트 0건으로 보임. 긴급 회귀 대응용으로만 사용.
-- 멱등: DROP POLICY IF EXISTS 후 재생성.

BEGIN;

DROP POLICY IF EXISTS clinic_events_select ON clinic_events;
CREATE POLICY clinic_events_select ON clinic_events
  FOR SELECT
  USING (
    clinic_id IN (
      SELECT staff.clinic_id
      FROM staff
      WHERE staff.id = auth.uid()
    )
  );

COMMENT ON POLICY clinic_events_select ON clinic_events IS NULL;

COMMIT;

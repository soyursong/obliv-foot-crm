-- ROLLBACK: T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL
-- 20260611190000_clinic_events_write_rls_canonical.sql 의 역적용.
-- clinic_events 쓰기 3정책을 원래의 비정규(staff.id=auth.uid()) 술어로 복원.
--
-- 주의: 롤백 시 write outlier 버그 재발 — ClinicCalendar 일정 추가/편집/삭제가
--        직원·관리자 거의 전원에게 막힘(파손 상태). 긴급 회귀 대응용으로만 사용.
-- 멱등: DROP POLICY IF EXISTS 후 재생성. (원본은 UPDATE 에 WITH CHECK 없음 → byte 복원)

BEGIN;

DROP POLICY IF EXISTS clinic_events_insert ON clinic_events;
CREATE POLICY clinic_events_insert ON clinic_events
  FOR INSERT
  WITH CHECK (
    clinic_id IN (
      SELECT staff.clinic_id FROM staff WHERE staff.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clinic_events_update ON clinic_events;
CREATE POLICY clinic_events_update ON clinic_events
  FOR UPDATE
  USING (
    clinic_id IN (
      SELECT staff.clinic_id FROM staff WHERE staff.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clinic_events_delete ON clinic_events;
CREATE POLICY clinic_events_delete ON clinic_events
  FOR DELETE
  USING (
    clinic_id IN (
      SELECT staff.clinic_id FROM staff WHERE staff.id = auth.uid()
    )
  );

COMMENT ON POLICY clinic_events_insert ON clinic_events IS NULL;
COMMENT ON POLICY clinic_events_update ON clinic_events IS NULL;
COMMENT ON POLICY clinic_events_delete ON clinic_events IS NULL;

COMMIT;

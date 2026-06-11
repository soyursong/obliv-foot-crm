-- ROLLBACK: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G1 (check_in_room_logs)
-- 20260611170000_check_in_room_logs_select_rls_canonical.sql 의 역적용.
-- 분리한 4정책(select/insert/update/delete)을 원래의 단일 [ALL] room_logs_clinic_rw 로 복원.
--
-- 주의: 롤백 시 SELECT 가 approved 게이트 없는 user_profiles clinic-match 로 되돌아감
--        (read parity 는 유지되나 canonical 하드닝 해제). 긴급 회귀 대응용으로만 사용.
-- 멱등: DROP POLICY IF EXISTS 후 재생성.

BEGIN;

DROP POLICY IF EXISTS room_logs_clinic_select ON check_in_room_logs;
DROP POLICY IF EXISTS room_logs_clinic_insert ON check_in_room_logs;
DROP POLICY IF EXISTS room_logs_clinic_update ON check_in_room_logs;
DROP POLICY IF EXISTS room_logs_clinic_delete ON check_in_room_logs;

DROP POLICY IF EXISTS room_logs_clinic_rw ON check_in_room_logs;
CREATE POLICY room_logs_clinic_rw ON check_in_room_logs
  FOR ALL
  USING (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

COMMIT;

-- T-20260529-foot-SPACE-AUTOROUTE REOPEN1: check_in_room_logs RLS 정책 수정
-- 원인: 기존 room_logs_clinic_access 정책이 user_profiles.user_id 참조 (비존재 컬럼)
--       → CREATE POLICY 실패 → RLS 활성화됐지만 정책 없음 → authenticated INSERT/SELECT 전부 거부
--       → check_in_room_logs 테이블 영구 공백 → 금일동선 전부 "—" 표기
-- 수정: user_id → id (user_profiles PK = auth.uid())
-- 추가: 오늘 날짜 active check-ins 역주입 (backfill)
-- Rollback: 20260529000010_check_in_room_logs_rls_fix.down.sql

BEGIN;

-- ── 1. 기존 잘못된 정책 제거 ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "room_logs_clinic_access" ON check_in_room_logs;

-- ── 2. 올바른 정책 생성 (user_profiles.id = auth.uid()) ──────────────────────────
CREATE POLICY "room_logs_clinic_rw" ON check_in_room_logs
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- ── 3. 오늘 날짜 active check-ins backfill ──────────────────────────────────────
-- 기존에 room 배정은 됐으나 room_log가 없는 check-ins에 INSERT
-- consultation_room
INSERT INTO check_in_room_logs (check_in_id, clinic_id, assigned_room, room_type, logged_at)
SELECT
  id,
  clinic_id,
  consultation_room,
  'consultation',
  now()
FROM check_ins
WHERE consultation_room IS NOT NULL
  AND clinic_id IS NOT NULL
  AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
  AND NOT EXISTS (
    SELECT 1 FROM check_in_room_logs crl
    WHERE crl.check_in_id = check_ins.id
      AND crl.room_type = 'consultation'
  );

-- treatment_room
INSERT INTO check_in_room_logs (check_in_id, clinic_id, assigned_room, room_type, logged_at)
SELECT
  id,
  clinic_id,
  treatment_room,
  'treatment',
  now()
FROM check_ins
WHERE treatment_room IS NOT NULL
  AND clinic_id IS NOT NULL
  AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
  AND NOT EXISTS (
    SELECT 1 FROM check_in_room_logs crl
    WHERE crl.check_in_id = check_ins.id
      AND crl.room_type = 'treatment'
  );

-- laser_room (가열성레이저 or 레이저실 구분)
INSERT INTO check_in_room_logs (check_in_id, clinic_id, assigned_room, room_type, logged_at)
SELECT
  id,
  clinic_id,
  laser_room,
  CASE WHEN laser_room = '가열성레이저' THEN 'heated_laser' ELSE 'laser' END,
  now()
FROM check_ins
WHERE laser_room IS NOT NULL
  AND clinic_id IS NOT NULL
  AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
  AND NOT EXISTS (
    SELECT 1 FROM check_in_room_logs crl
    WHERE crl.check_in_id = check_ins.id
      AND crl.room_type IN ('laser', 'heated_laser')
  );

COMMIT;

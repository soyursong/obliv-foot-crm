-- T-20260524-foot-ROOM-NEXTDAY-STAFF
-- daily_room_status 확장: 익일 사전비활성화 + staff 권한 확장
--
-- AC-1/2: date ≤ CURRENT_DATE+1 (익일까지 허용, 무제한 미래 차단)
-- AC-3/4: staff 계정도 본인 담당 방 토글 가능 (room_assignments.staff_id 기준)
-- AC-6: disabled_by (비활성화 설정자) 컬럼 추가 — 이력 조회용
--
-- 의존: 20260524010000_daily_room_status.sql (테이블), 20260524020000 (carry_over)
-- Rollback: 20260524030000_daily_room_status_nextday_staff.down.sql

BEGIN;

-- ============================================================
-- 1. disabled_by 컬럼 추가 (AC-6 이력)
-- ============================================================
ALTER TABLE daily_room_status
  ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN daily_room_status.disabled_by IS
  'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-6: 방 비활성화 설정자 staff.id.
   is_active=false 전환 시 기록. 활성화 시 NULL 유지 (이력 보존).
   staff.id 삭제 시 SET NULL.';

-- ============================================================
-- 2. date ≤ CURRENT_DATE+1 CHECK 제약 (AC-2)
--    INSERT/UPDATE 시 무제한 미래 예약 차단. 최대 D+1(익일)만 허용.
--    기존 과거 레코드는 영향 없음 (CURRENT_DATE+1보다 작거나 같으므로 통과).
-- ============================================================
ALTER TABLE daily_room_status
  ADD CONSTRAINT daily_room_status_date_max_nextday
  CHECK (date <= CURRENT_DATE + 1);

COMMENT ON CONSTRAINT daily_room_status_date_max_nextday ON daily_room_status IS
  'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-2: INSERT/UPDATE 시 date <= CURRENT_DATE+1 강제.
   오늘(D+0) 및 익일(D+1)만 허용. D+2 이후 차단.';

-- ============================================================
-- 3. RLS 정책 교체: admin/manager 전용 → staff 이상 확장 (AC-3/4)
-- ============================================================

-- 기존 admin_all 정책 제거 (admin/manager 전용)
DROP POLICY IF EXISTS daily_room_status_admin_all ON daily_room_status;

-- 3a. admin/manager: 전체 방 토글 가능 (기존 동작 유지)
CREATE POLICY daily_room_status_admin_manager_write ON daily_room_status
  FOR ALL TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

COMMENT ON POLICY daily_room_status_admin_manager_write ON daily_room_status IS
  'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-3: admin/manager는 전체 방 비활성화 토글.
   is_admin_or_manager() 재사용 (admin/manager/director 포함).';

-- 3b. staff: 본인 담당 방만 토글 가능 (AC-4)
--     room_assignments.staff_id = current_staff_id() 기준
--     날짜 무관 (room_assignments에 당일/이전 날짜 데이터 모두 참조 가능)
CREATE POLICY daily_room_status_staff_own_write ON daily_room_status
  FOR ALL TO authenticated
  USING (
    is_approved_user()
    AND current_user_role() = 'staff'
    AND EXISTS (
      SELECT 1 FROM room_assignments ra
      WHERE ra.clinic_id = daily_room_status.clinic_id
        AND ra.room_name = daily_room_status.room_name
        AND ra.staff_id = current_staff_id()
    )
  )
  WITH CHECK (
    is_approved_user()
    AND current_user_role() = 'staff'
    AND EXISTS (
      SELECT 1 FROM room_assignments ra
      WHERE ra.clinic_id = daily_room_status.clinic_id
        AND ra.room_name = daily_room_status.room_name
        AND ra.staff_id = current_staff_id()
    )
  );

COMMENT ON POLICY daily_room_status_staff_own_write ON daily_room_status IS
  'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-4: staff는 room_assignments에서 본인(current_staff_id())이
   담당하는 방만 비활성화 토글 가능. 타인 담당 방 접근 차단.';

-- ============================================================
-- 4. 인덱스: disabled_by 조회 최적화 (AC-6 이력 쿼리)
-- ============================================================
CREATE INDEX IF NOT EXISTS daily_room_status_disabled_by_idx
  ON daily_room_status (clinic_id, date DESC, disabled_by)
  WHERE disabled_by IS NOT NULL;

COMMENT ON INDEX daily_room_status_disabled_by_idx IS
  'T-20260524-foot-ROOM-NEXTDAY-STAFF AC-6: 관리자 이력 조회 (clinic+날짜순) 최적화.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인)
-- ============================================================
-- 1) 컬럼 추가 확인
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name='daily_room_status' AND column_name='disabled_by';
--
-- 2) CHECK 제약 확인
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid='daily_room_status'::regclass AND conname='daily_room_status_date_max_nextday';
--
-- 3) RLS 정책 확인
-- SELECT policyname, cmd, qual FROM pg_policies
--  WHERE schemaname='public' AND tablename='daily_room_status' ORDER BY policyname;

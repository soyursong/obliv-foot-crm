-- T-20260523-foot-SPACE-DASH-AUTOSYNC Feature B: 슬롯 방 비활성화
-- daily_room_status 테이블: 당일 방 비활성화 상태 관리
--
-- 설계:
--   - 방 비활성화는 당일 한정 (AC-B3 기본값)
--   - 행이 존재하고 is_active=false → 비활성
--   - 행 없음 or is_active=true → 활성
--   - UNIQUE(clinic_id, date, room_name) → upsert 안전
--
-- Rollback: 20260524010000_daily_room_status.down.sql
-- Ticket:   T-20260523-foot-SPACE-DASH-AUTOSYNC

BEGIN;

-- ============================================================
-- 1. daily_room_status 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_room_status (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  room_name   TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, date, room_name)
);

COMMENT ON TABLE daily_room_status IS
  'T-20260523-foot-SPACE-DASH-AUTOSYNC: 당일 방 비활성화 상태 관리.
   is_active=false → 비활성 (당일 한정).
   행 없음 → 활성으로 간주.';

-- ============================================================
-- 2. RLS 활성화
-- ============================================================
ALTER TABLE daily_room_status ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. RLS 정책
-- ============================================================

-- 승인된 사용자는 모두 읽기 가능
CREATE POLICY daily_room_status_approved_read ON daily_room_status
  FOR SELECT TO authenticated
  USING (is_approved_user());

COMMENT ON POLICY daily_room_status_approved_read ON daily_room_status IS
  'T-20260523-foot-SPACE-DASH-AUTOSYNC: 승인된 사용자 전체 읽기.';

-- admin/manager만 쓰기 가능 (INSERT/UPDATE/DELETE)
CREATE POLICY daily_room_status_admin_all ON daily_room_status
  FOR ALL TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

COMMENT ON POLICY daily_room_status_admin_all ON daily_room_status IS
  'T-20260523-foot-SPACE-DASH-AUTOSYNC: admin/manager만 방 비활성화 토글 가능. is_admin_or_manager() 재사용.';

-- ============================================================
-- 4. 인덱스 (당일 조회 최적화)
-- ============================================================
CREATE INDEX IF NOT EXISTS daily_room_status_clinic_date_idx
  ON daily_room_status (clinic_id, date);

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 확인용)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name='daily_room_status';
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='daily_room_status'
--  ORDER BY cmd, policyname;

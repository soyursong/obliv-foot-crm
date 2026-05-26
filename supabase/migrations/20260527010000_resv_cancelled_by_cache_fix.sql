-- T-20260526-foot-STAFF-CANCEL-ERR: reservations.cancelled_by 스키마 캐시 fix
--
-- 원인:
--   20260525000001_reservation_cancel_by.sql 에서 cancelled_by TEXT NULL 컬럼 추가 후
--   PostgREST 스키마 캐시가 자동 갱신되지 않아
--   "Could not find the 'cancelled_by' column of 'reservations' in the schema cache"
--   오류 발생 → 직원 계정 예약 취소 실패.
--
-- 컬럼 자체는 DB에 정상 존재하고, RLS(reservations_staff_update) + 컬럼 권한도 정상.
-- 이 마이그레이션은:
--   1) 컬럼 재확인 (ADD COLUMN IF NOT EXISTS — 이미 존재하면 NOOP)
--   2) NOTIFY pgrst로 PostgREST 스키마 캐시 즉시 강제 갱신
--   3) reservations_staff_update 정책 재확인 (없으면 생성)
--
-- Rollback: 20260527010000_resv_cancelled_by_cache_fix.rollback.sql
-- Ticket:   T-20260526-foot-STAFF-CANCEL-ERR

-- 1. 컬럼 재확인 (idempotent)
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT NULL;

COMMENT ON COLUMN reservations.cancelled_by
  IS '취소 처리 직원 user_id — T-20260525-foot-RESV-CANCEL-CTX (캐시 fix: T-20260526-foot-STAFF-CANCEL-ERR)';

-- 2. RLS 정책 재확인 — reservations_staff_update 없으면 생성
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'reservations'
      AND policyname = 'reservations_staff_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY reservations_staff_update ON reservations
        FOR UPDATE TO authenticated
        USING (is_approved_user())
        WITH CHECK (is_approved_user())
    $policy$;
    RAISE NOTICE 'reservations_staff_update policy 재생성됨';
  ELSE
    RAISE NOTICE 'reservations_staff_update policy 이미 존재 — NOOP';
  END IF;
END $$;

-- 3. PostgREST 스키마 캐시 강제 갱신 (캐시 stale 문제 즉시 해소)
NOTIFY pgrst, 'reload schema';

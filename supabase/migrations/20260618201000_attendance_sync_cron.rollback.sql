-- ROLLBACK — T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM (20260618201000_attendance_sync_cron.sql)
--
-- sync worker(cron job + 함수) 제거. staff_attendance 테이블/데이터 무접촉
-- (테이블 rollback 은 20260618200000_staff_attendance_ssot.rollback.sql).
-- rollback 후 staff_attendance 는 더 이상 자동 갱신되지 않음(stale) → 배정화면이
-- 이미 DB read 로 전환됐다면(AC-2) read 경로도 함께 시트 직접 read 로 원복 필요.
-- 본 sync-only rollback 은 read 전환 전(현 시트 직접 read 유지) 단계에서 안전.

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('foot-attendance-sync');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.trigger_attendance_sync();

COMMIT;

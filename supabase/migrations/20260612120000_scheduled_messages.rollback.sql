-- ============================================================
-- ROLLBACK: T-20260612-foot-SMS-SCHEDULE-SEND-OPTION
-- 20260612120000_scheduled_messages.sql 역적용
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- ============================================================
-- 주의: scheduled_messages 에 미발송(pending) 행이 남아 있으면 함께 삭제된다.
--   롤백 전 SELECT COUNT(*) FROM scheduled_messages WHERE status='pending'; 로 확인 권장.
-- ============================================================

BEGIN;

-- 1. pg_cron 해제
DO $$
BEGIN
  PERFORM cron.unschedule('foot-scheduled-msg-dispatch');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. 디스패처 함수 제거
DROP FUNCTION IF EXISTS public.dispatch_scheduled_messages(BOOLEAN);

-- 3. 테이블 제거(인덱스·트리거·RLS 정책 동반 삭제)
DROP TABLE IF EXISTS public.scheduled_messages CASCADE;

COMMIT;

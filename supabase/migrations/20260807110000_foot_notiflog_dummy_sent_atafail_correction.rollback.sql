-- ROLLBACK — 20260807110000_foot_notiflog_dummy_sent_atafail_correction.sql
-- archive before-image로 status/error_code 원복(순소실 0). archive 테이블은 감사 목적 보존(수동 DROP 별도).
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)

BEGIN;

DO $$
DECLARE n int;
BEGIN
  UPDATE public.notification_logs nl
     SET status = a.status,
         error_code = a.error_code,
         updated_at = now()
    FROM public.notification_logs_dummy_sent_archive_20260807 a
   WHERE nl.id = a.id
     AND nl.status = 'ata_fail'
     AND nl.error_code = 'blocked_invalid_recipient';   -- 정정된 행만 원복(타 축 무접촉)
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'rollback restored % rows to before-image (expected 582)', n;
END $$;

COMMIT;

-- 검증: SELECT count(*) FROM notification_logs WHERE recipient_phone LIKE 'DUMMY-%' AND customer_id IS NULL AND status='sent'; → 582 복원
-- archive 테이블 완전 폐기(선택): DROP TABLE IF EXISTS public.notification_logs_dummy_sent_archive_20260807;

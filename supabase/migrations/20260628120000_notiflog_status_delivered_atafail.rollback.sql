-- ROLLBACK: T-20260628-foot-NOTIFLOG-STATUS-CHECK-DELIVERED-ALTER
-- notification_logs.status CHECK 를 8값 → 기존 6값으로 환원
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 정방향: 20260628120000_notiflog_status_delivered_atafail.sql
--
-- ⚠️  사전 조건: 롤백 전 'delivered' / 'ata_fail' 행이 존재하면 6값 CHECK 추가가
--     실패한다(23514). 롤백 필요 시 아래로 잔존 행을 먼저 확인할 것:
--       SELECT status, count(*) FROM public.notification_logs
--         WHERE status IN ('delivered','ata_fail') GROUP BY status;
--     ADDITIVE 직후 즉시 롤백이라면 신규 버킷 사용 전이므로 0행이어야 한다.
--     운영 중 데이터가 쌓였다면 매핑(delivered→sent / ata_fail→failed 등)을
--     supervisor 판단 하에 선행한 뒤 롤백한다.

BEGIN;

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN ('pending','sent','failed','cancelled','opt_out','skipped'));

COMMENT ON CONSTRAINT notification_logs_status_check ON public.notification_logs IS
  'T-20260525-foot-MESSAGING-V1: 발송 상태 6값 (delivered/ata_fail 롤백됨).';

COMMIT;

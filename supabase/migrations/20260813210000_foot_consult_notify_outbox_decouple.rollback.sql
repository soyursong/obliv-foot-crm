-- ROLLBACK: 20260813210000_foot_consult_notify_outbox_decouple.sql
-- T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN
--
-- 주의: 롤백 전 잔여 pending/dlq 건 확인 권장(미발송분 유실 가능):
--   SELECT status, dlq, count(*) FROM public.consult_notify_outbox GROUP BY 1,2;
--   미발송(pending) 잔량이 있으면 outbox DROP 전 수동 발송/기록.
--
-- ADDITIVE 원복: worker/함수/테이블 제거 + check_ins CHECK 원상('failed' 제거).
--   'failed' 잔존 행은 CHECK 원복 위반 방지 위해 'sending' 으로 coerce(비-terminal 안전값, 발송상태 정보만 완화).

BEGIN;

-- VG2 롤백: pg_cron 잡 해제
SELECT cron.unschedule('foot-consult-notify-worker')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-consult-notify-worker');

-- worker / 알람 / enqueue 함수 제거
--   C23 grant-seal 대칭: DROP FUNCTION 이 함수 ACL(REVOKE PUBLIC/anon/authenticated + GRANT service_role)을
--   동반 제거하므로 별도 REVOKE 불요. (부분 롤백으로 함수를 남길 경우에만 grant-seal 절 복원 필요.)
DROP FUNCTION IF EXISTS public.process_consult_notify_outbox();
DROP FUNCTION IF EXISTS public.alert_consult_notify_dlq();
DROP FUNCTION IF EXISTS public.enqueue_consult_notify(UUID, UUID, TEXT, TEXT, UUID);

-- VG1/VG3 롤백: outbox 테이블 제거 (인덱스 동반 DROP)
DROP TABLE IF EXISTS public.consult_notify_outbox;

-- VG4-a 롤백: check_ins.consult_notify_status CHECK 원상 (NULL/'sending'/'sent')
DO $rollback_status_check$
BEGIN
  -- 'failed' 잔존 → 원복 CHECK 위반 방지 coerce
  UPDATE public.check_ins
     SET consult_notify_status = 'sending'
   WHERE consult_notify_status = 'failed';

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_check_ins_consult_notify_status'
       AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins DROP CONSTRAINT chk_check_ins_consult_notify_status;
  END IF;
  ALTER TABLE public.check_ins
    ADD CONSTRAINT chk_check_ins_consult_notify_status
    CHECK (consult_notify_status IS NULL OR consult_notify_status IN ('sending', 'sent'));
END
$rollback_status_check$;

COMMENT ON COLUMN public.check_ins.consult_notify_status IS
  'T-20260729 변경2: 상담 배정 상담대기방 발송상태. NULL=미확정, ''sending''=claim, ''sent''=발송완료.';

COMMIT;

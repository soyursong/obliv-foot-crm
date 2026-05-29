-- T-20260529-foot-RESV-CHECKIN-NOSAVE 롤백
-- unique_reservation_checkin 인덱스를 원복 (cancelled 포함 버전)

BEGIN;

DROP INDEX IF EXISTS unique_reservation_checkin;

-- 원복: cancelled 포함 버전 (기존 동작)
CREATE UNIQUE INDEX unique_reservation_checkin
  ON public.check_ins (reservation_id)
  WHERE reservation_id IS NOT NULL;

COMMIT;

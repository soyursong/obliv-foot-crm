-- ROLLBACK: T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT
-- fn_checkin_sync_reservation() 를 20260506000010(SELFCHECKIN-MERGE) 원본 body 로 복원
--   (WHERE status = 'confirmed' 정확일치). 트리거 바인딩/OWNER 불변.

BEGIN;

CREATE OR REPLACE FUNCTION fn_checkin_sync_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET status = 'checked_in'
    WHERE id = NEW.reservation_id
      AND status = 'confirmed';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION fn_checkin_sync_reservation() OWNER TO postgres;

COMMIT;

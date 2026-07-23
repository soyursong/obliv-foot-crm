-- ROLLBACK 20260723210000_foot_cancel_outbox_distinct_per_event_keying
-- T-20260723-foot-CANCEL-OUTBOX-ENQUEUE-DISTINCT
-- 트리거 함수 revert (DA: 롤백 = 트리거 함수 revert).
--   1) enqueue_dopamine_callback() → 20260629150000 정의(bare v_event_id, source_system=foot) 복원.
--   2) BEFORE UPDATE 트리거 trg_ensure_reservation_cancelled_at + 함수 제거.
-- ※ 이미 적재된 composite event_id outbox 행은 무해(멱등키 문자열일 뿐, 소비자 무영향) → 데이터 정정 불요.

BEGIN;

-- 1) BEFORE 트리거 + 함수 제거
DROP TRIGGER IF EXISTS trg_ensure_reservation_cancelled_at ON public.reservations;
DROP FUNCTION IF EXISTS public.ensure_reservation_cancelled_at();

-- 2) enqueue_dopamine_callback() 원복 (20260629150000_foot_resv_status_noshow_to_no_show)
CREATE OR REPLACE FUNCTION public.enqueue_dopamine_callback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type     TEXT;
  v_event_id       TEXT;
  v_reservation_id UUID;
  v_cue_card_id    TEXT;
  v_resv           RECORD;
BEGIN
  IF TG_TABLE_NAME = 'check_ins' THEN
    IF NEW.reservation_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT r.id, r.source_system, r.external_id
      INTO v_resv
      FROM public.reservations r
      WHERE r.id = NEW.reservation_id;
    IF NOT FOUND
       OR v_resv.source_system IS DISTINCT FROM 'dopamine'
       OR v_resv.external_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_type     := 'visited';
    v_event_id       := NEW.id::TEXT;
    v_reservation_id := NEW.reservation_id;
    v_cue_card_id    := v_resv.external_id;
  ELSE
    IF NEW.status NOT IN ('no_show','cancelled') THEN
      RETURN NEW;
    END IF;
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.source_system IS DISTINCT FROM 'dopamine'
       OR NEW.external_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_type     := NEW.status;
    v_event_id       := NEW.id::TEXT;
    v_reservation_id := NEW.id;
    v_cue_card_id    := NEW.external_id;
  END IF;

  INSERT INTO public.dopamine_callback_outbox
    (event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    v_event_type,
    v_event_id,
    v_reservation_id,
    v_cue_card_id,
    jsonb_build_object(
      'source_system',  'foot',
      'event_type',     v_event_type,
      'event_id',       v_event_id,
      'cue_card_id',    v_cue_card_id,
      'reservation_id', v_reservation_id,
      'occurred_at',    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_dopamine_callback() IS
  'T-CALLBACK-EF-4: 라이프사이클(visited/no_show/cancelled/rejected) → outbox 적재. '
  '도파민 연동(source_system=dopamine + external_id) 건만. status=계약 event_type 동일(NOSHOW-CANONICAL). 동기 발송 안 함.';

COMMIT;

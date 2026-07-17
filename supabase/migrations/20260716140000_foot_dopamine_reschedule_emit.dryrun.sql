-- DRY-RUN (No-Persistence): T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT (reschedule emit)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): CHECK 확장(reschedule 등재) + 트리거함수/트리거 실존 검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션에서 pg_trigger/pg_constraint 부재 재확인.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;
ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected','reschedule'));

CREATE OR REPLACE FUNCTION public.enqueue_dopamine_reschedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT;
BEGIN
  IF NEW.reservation_date IS NOT DISTINCT FROM OLD.reservation_date THEN RETURN NEW; END IF;
  IF NEW.status IN ('cancelled','no_show') THEN RETURN NEW; END IF;
  IF NEW.source_system IS DISTINCT FROM 'dopamine' OR NEW.external_id IS NULL THEN RETURN NEW; END IF;
  v_id := gen_random_uuid()::TEXT;
  INSERT INTO public.dopamine_callback_outbox
    (id, event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    v_id::UUID, 'reschedule', v_id, NEW.id, NEW.external_id,
    jsonb_build_object(
      'source_system','foot','event_type','reschedule','event_id',v_id,
      'cue_card_id',NEW.external_id,'crm_reservation_id',NEW.id,'reservation_id',NEW.id,
      'old_date',to_char(OLD.reservation_date,'YYYY-MM-DD'),
      'new_date',to_char(NEW.reservation_date,'YYYY-MM-DD'),
      'changed_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'occurred_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dopamine_cb_resv_reschedule ON public.reservations;
CREATE TRIGGER trg_dopamine_cb_resv_reschedule
  AFTER UPDATE OF reservation_date ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_dopamine_reschedule();

-- ── in-txn assertion ─────────────────────────────────────────────────
DO $chk$
BEGIN
  -- (a) CHECK 에 reschedule 등재됐는지
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dopamine_callback_outbox_event_type_check'
       AND pg_get_constraintdef(oid) LIKE '%reschedule%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: event_type CHECK 에 reschedule 미등재';
  END IF;
  -- (b) 기존 4값 보존 확인 (ADDITIVE 무손상)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dopamine_callback_outbox_event_type_check'
       AND pg_get_constraintdef(oid) LIKE '%cancelled%'
       AND pg_get_constraintdef(oid) LIKE '%visited%'
       AND pg_get_constraintdef(oid) LIKE '%no_show%'
       AND pg_get_constraintdef(oid) LIKE '%rejected%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 기존 event_type 값 소실 (ADDITIVE 위반)';
  END IF;
  -- (c) 트리거함수 실존
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enqueue_dopamine_reschedule'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: enqueue_dopamine_reschedule() 미생성';
  END IF;
  -- (d) 트리거 바인딩 (reservation_date UPDATE)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_dopamine_cb_resv_reschedule' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: trg_dopamine_cb_resv_reschedule 미바인딩';
  END IF;
  RAISE NOTICE 'DRYRUN-OK: reschedule emit CHECK+trigger 검증 통과';
END;
$chk$;

ROLLBACK;

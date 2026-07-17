-- DRY-RUN (No-Persistence): T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE (접근 B, stage 축 emit)
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): CHECK 확장(visited_stage 등재) + 기존값 보존(ADDITIVE)
--     + 트리거함수/트리거 실존 검증. 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)의 별 트랜잭션에서
--     pg_trigger/pg_proc/pg_constraint 부재 재확인(assertAbsent). 본 파일은 in-txn 검증 companion.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;
ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected','reschedule','visited_stage'));

CREATE OR REPLACE FUNCTION public.enqueue_dopamine_visited_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resv RECORD;
BEGIN
  IF NEW.reservation_id IS NULL THEN RETURN NEW; END IF;
  SELECT r.id, r.source_system, r.external_id
    INTO v_resv FROM public.reservations r WHERE r.id = NEW.reservation_id;
  IF NOT FOUND
     OR v_resv.source_system IS DISTINCT FROM 'dopamine'
     OR v_resv.external_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.dopamine_callback_outbox
    (event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    'visited_stage', NEW.id::TEXT, NEW.reservation_id, v_resv.external_id,
    jsonb_build_object(
      'source_system','foot','clinic_slug','jongno-foot','external_id',v_resv.external_id,
      'type','visited','event_id',NEW.id::TEXT,
      'occurred_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'payload',jsonb_build_object('checkin_method','crm_server_emit','reservation_id',NEW.reservation_id)
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin_stage ON public.check_ins;
CREATE TRIGGER trg_dopamine_cb_checkin_stage
  AFTER INSERT ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_dopamine_visited_stage();

-- ── in-txn assertion ─────────────────────────────────────────────────
DO $chk$
BEGIN
  -- (a) CHECK 에 visited_stage 등재됐는지
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dopamine_callback_outbox_event_type_check'
       AND pg_get_constraintdef(oid) LIKE '%visited_stage%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: event_type CHECK 에 visited_stage 미등재';
  END IF;
  -- (b) 기존 값 보존 확인 (ADDITIVE 무손상)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dopamine_callback_outbox_event_type_check'
       AND pg_get_constraintdef(oid) LIKE '%visited%'
       AND pg_get_constraintdef(oid) LIKE '%no_show%'
       AND pg_get_constraintdef(oid) LIKE '%cancelled%'
       AND pg_get_constraintdef(oid) LIKE '%rejected%'
       AND pg_get_constraintdef(oid) LIKE '%reschedule%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 기존 event_type 값 소실 (ADDITIVE 위반)';
  END IF;
  -- (c) 트리거함수 실존
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enqueue_dopamine_visited_stage'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: enqueue_dopamine_visited_stage() 미생성';
  END IF;
  -- (d) 트리거 바인딩 (check_ins AFTER INSERT)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_dopamine_cb_checkin_stage' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: trg_dopamine_cb_checkin_stage 미바인딩';
  END IF;
  -- (e) 기존 process_status 축 트리거 무손상 (동일 check_ins INSERT 양축 공존)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_dopamine_cb_checkin' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 기존 trg_dopamine_cb_checkin(process_status 축) 소실';
  END IF;
  RAISE NOTICE 'DRYRUN-OK: visited_stage emit CHECK+trigger 검증 통과 (양축 공존 확인)';
END;
$chk$;

ROLLBACK;

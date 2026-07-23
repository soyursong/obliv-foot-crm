-- DRY-RUN (No-Persistence): T-20260723-foot-CANCEL-OUTBOX-ENQUEUE-DISTINCT
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(BEGIN/COMMIT)을 **제거** → 이 파일 자체 BEGIN..ROLLBACK 으로 무영속.
--   · up.sql 본체 = CREATE OR REPLACE FUNCTION + CREATE TRIGGER (멱등) → prod 실적용 여부와 무관하게
--     롤백 봉투 안에서 재선언·검증 가능. 무영속 불가 DDL(§5) 없음(함수/트리거 replace 만).
--   · in-txn assertion(DO $chk$): distinct-per-occurrence 키잉의 실제 동선(취소→outbox 1행 /
--     재활성→재취소→distinct 2번째 행 / 동일 cancelled_at 재취소→dedup)을 합성 예약으로 재현·검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe): canonical 러너가 별 트랜잭션에서 cue_card_id LIKE 'DRYRUN-CUE-%'
--     outbox/reservations 행 부재(0건)를 재확인(assertAbsent). 본 파일은 in-txn 검증 companion.
--   · ⚠ within-txn now() = transaction_timestamp 은 STABLE → 단일 txn 내 두 취소는 동일 now().
--     실사용 재취소는 별 트랜잭션(later transaction_timestamp)이므로 distinct. 본 dryrun 은
--     그 별-txn now() 전진을 재취소 UPDATE 에 명시 cancelled_at(+interval)로 대입해 충실 재현.
--     (BEFORE 트리거는 cancelled_at NULL 일 때만 채우므로 명시값은 보존됨.)
BEGIN;

-- ══ up.sql 본체 (BEGIN/COMMIT strip, CREATE OR REPLACE = 멱등) ═══════════════════
CREATE OR REPLACE FUNCTION public.ensure_reservation_cancelled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_reservation_cancelled_at ON public.reservations;
CREATE TRIGGER trg_ensure_reservation_cancelled_at
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_reservation_cancelled_at();

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
    IF NEW.status = 'cancelled' THEN
      v_event_id := NEW.id::TEXT || ':' || extract(epoch from NEW.cancelled_at)::TEXT;
    ELSE
      v_event_id := NEW.id::TEXT;
    END IF;
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

-- ══ in-txn assertion — 검증 recipe (distinct-per-occurrence) ═════════════════════
DO $chk$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- jongno-foot (오블리브 종로 풋센터)
  v_cue    text := 'DRYRUN-CUE-' || gen_random_uuid()::text;
  v_id     uuid;
  v_ca1    timestamptz;
  v_n      int;
  v_eids   text[];
BEGIN
  -- 합성 도파민 연동 예약(롤백)
  INSERT INTO public.reservations (clinic_id, reservation_date, reservation_time, status, source_system, external_id)
  VALUES (v_clinic, current_date, '10:00', 'confirmed', 'dopamine', v_cue)
  RETURNING id INTO v_id;

  -- recipe#1: 취소 1건(명시 cancelled_at 없음 → BEFORE 트리거 auto-fill = prereq#1) → outbox 1행
  UPDATE public.reservations SET status='cancelled' WHERE id=v_id;
  SELECT cancelled_at INTO v_ca1 FROM public.reservations WHERE id=v_id;
  IF v_ca1 IS NULL THEN RAISE EXCEPTION 'DRYRUN-FAIL: prereq#1 cancelled_at auto-fill 실패'; END IF;
  SELECT count(*) INTO v_n FROM public.dopamine_callback_outbox WHERE event_type='cancelled' AND reservation_id=v_id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: recipe#1 취소#1 outbox=% (기대 1)', v_n; END IF;

  -- 재활성(FE parity): cancelled_at NULL 리셋
  UPDATE public.reservations SET status='confirmed', cancelled_at=NULL, cancel_reason=NULL WHERE id=v_id;

  -- recipe#2: 재취소(별-txn now() 전진 = 명시 +7s) → distinct 2번째 행
  UPDATE public.reservations SET status='cancelled', cancelled_at = v_ca1 + interval '7 seconds' WHERE id=v_id;
  SELECT count(*), array_agg(event_id ORDER BY event_id) INTO v_n, v_eids
    FROM public.dopamine_callback_outbox WHERE event_type='cancelled' AND reservation_id=v_id;
  IF v_n <> 2 THEN RAISE EXCEPTION 'DRYRUN-FAIL: recipe#2 재취소후 outbox=% (기대 distinct 2)', v_n; END IF;
  IF v_eids[1] = v_eids[2] THEN RAISE EXCEPTION 'DRYRUN-FAIL: event_id 비-distinct: %', v_eids; END IF;

  -- invariant#2: 동일 cancelled_at(같은 occurrence) 재취소 → dedup(멱등) → 3번째 행 없음
  UPDATE public.reservations SET status='confirmed', cancelled_at=NULL WHERE id=v_id;
  UPDATE public.reservations SET status='cancelled', cancelled_at = v_ca1 + interval '7 seconds' WHERE id=v_id;
  SELECT count(*) INTO v_n FROM public.dopamine_callback_outbox WHERE event_type='cancelled' AND reservation_id=v_id;
  IF v_n <> 2 THEN RAISE EXCEPTION 'DRYRUN-FAIL: invariant#2 동일 cancelled_at dup 발생 outbox=% (기대 2)', v_n; END IF;

  RAISE NOTICE 'DRYRUN-OK: recipe#1(취소1건→1행)·recipe#2(재취소→distinct 2행 %)·invariant#2(동일ts dedup) 통과', v_eids;
END
$chk$;

ROLLBACK;

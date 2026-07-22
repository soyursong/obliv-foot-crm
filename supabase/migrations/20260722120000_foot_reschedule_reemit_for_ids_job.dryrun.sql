-- DRY-RUN (No-Persistence): T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE (reschedule re-emit executable)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): 함수 실존 + 시그니처 + SECURITY DEFINER + search_path +
--     실 동작(임시 데이터로 dry_run·emit·멱등·게이트·batch_tag guard) 검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션에서 pg_proc 부재 재확인.
--     (신규 함수 1개 ADDITIVE → ROLLBACK 후 pg_proc.proname='reemit_reschedule_for_ids' 0행이어야 함)
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reemit_reschedule_for_ids(
  p_reservation_ids UUID[],
  p_batch_tag       TEXT,
  p_dry_run         BOOLEAN DEFAULT true
)
RETURNS TABLE (
  reservation_id UUID, action TEXT, reason TEXT, event_id TEXT, new_date DATE, cue_card_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_id       UUID;
  v_rec      RECORD;
  v_event_id TEXT;
  v_rowcount INT;
  v_iso      TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF p_batch_tag IS NULL OR btrim(p_batch_tag) = '' THEN
    RAISE EXCEPTION 'p_batch_tag required (event_id namespace / idempotency anchor)';
  END IF;
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_id IN ARRAY p_reservation_ids LOOP
    SELECT r.id, r.external_id, r.source_system, r.reservation_date, r.status
      INTO v_rec FROM public.reservations r WHERE r.id = v_id;
    IF NOT FOUND THEN
      reservation_id := v_id; action := 'skip'; reason := 'reservation_not_found';
      event_id := NULL; new_date := NULL; cue_card_id := NULL; RETURN NEXT; CONTINUE;
    END IF;
    IF v_rec.source_system IS DISTINCT FROM 'dopamine' THEN
      reservation_id := v_id; action := 'skip'; reason := 'not_dopamine_linked';
      event_id := NULL; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_rec.external_id IS NULL THEN
      reservation_id := v_id; action := 'skip'; reason := 'no_external_id';
      event_id := NULL; new_date := v_rec.reservation_date; cue_card_id := NULL; RETURN NEXT; CONTINUE;
    END IF;
    IF v_rec.reservation_date IS NULL THEN
      reservation_id := v_id; action := 'skip'; reason := 'no_reservation_date';
      event_id := NULL; new_date := NULL; cue_card_id := v_rec.external_id; RETURN NEXT; CONTINUE;
    END IF;
    v_event_id := v_rec.id::TEXT || ':reemit:' || p_batch_tag;
    IF p_dry_run THEN
      reservation_id := v_id; action := 'would_emit'; reason := NULL;
      event_id := v_event_id; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
      RETURN NEXT; CONTINUE;
    END IF;
    INSERT INTO public.dopamine_callback_outbox
      (event_type, event_id, reservation_id, cue_card_id, payload)
    VALUES (
      'reschedule', v_event_id, v_rec.id, v_rec.external_id,
      jsonb_build_object(
        'source_system','foot','event_type','reschedule','event_id',v_event_id,
        'cue_card_id',v_rec.external_id,'crm_reservation_id',v_rec.id,'reservation_id',v_rec.id,
        'changed_at',v_iso,'new_date',to_char(v_rec.reservation_date,'YYYY-MM-DD'),
        'occurred_at',v_iso,'reemit_batch',p_batch_tag)
    )
    ON CONFLICT (event_type, event_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    reservation_id := v_id;
    action := CASE WHEN v_rowcount > 0 THEN 'emitted' ELSE 'noop_conflict' END;
    reason := NULL; event_id := v_event_id; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END $fn$;

REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) TO service_role;

-- ── in-txn assertion (함수 실존/속성 + 실동작 self-QA) ─────────────────
DO $chk$
DECLARE
  v_before   BIGINT;
  v_after    BIGINT;
  v_rid      UUID;
  v_cue      TEXT;
  v_dry      RECORD;
  v_emit     RECORD;
  v_reemit   RECORD;
  v_skipnf   RECORD;
  v_skipnd   RECORD;
  v_evid     TEXT;
  v_batch    TEXT := 'dryrun-selfqa-batch';
  v_clinic   UUID;
  v_slug     TEXT := 'dryrun-reemit-' || gen_random_uuid()::TEXT;
BEGIN
  -- (a) 함수 실존 + 시그니처
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'reemit_reschedule_for_ids'
       AND pg_get_function_identity_arguments(p.oid) = 'p_reservation_ids uuid[], p_batch_tag text, p_dry_run boolean'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: reemit_reschedule_for_ids(uuid[],text,boolean) 미생성/시그니처 불일치';
  END IF;

  -- (b) SECURITY DEFINER + search_path 고정
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='reemit_reschedule_for_ids'
       AND p.prosecdef = true
       AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: SECURITY DEFINER / search_path 고정 미설정';
  END IF;

  -- (c) 접근통제: anon/authenticated EXECUTE 부재 + service_role 존재
  IF has_function_privilege('anon',
       'public.reemit_reschedule_for_ids(uuid[],text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.reemit_reschedule_for_ids(uuid[],text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: anon/authenticated EXECUTE 잔존 (default-deny 위반)';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.reemit_reschedule_for_ids(uuid[],text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: service_role EXECUTE 부재';
  END IF;

  -- (d) batch_tag guard — 빈/NULL 거부
  BEGIN
    PERFORM * FROM public.reemit_reschedule_for_ids(ARRAY[gen_random_uuid()]::uuid[], '', false);
    RAISE EXCEPTION 'DRYRUN-FAIL: 빈 batch_tag 가 거부되지 않음';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%DRYRUN-FAIL%' THEN RAISE; END IF;  -- 위 assertion 자체 실패는 전파
      -- p_batch_tag required 예외 = 정상
  END;

  -- (e) reservation_not_found skip — 존재하지 않는 id
  SELECT * INTO v_skipnf FROM public.reemit_reschedule_for_ids(
    ARRAY['00000000-0000-0000-0000-0000000000ff'::uuid], v_batch, true) LIMIT 1;
  IF v_skipnf.action <> 'skip' OR v_skipnf.reason <> 'reservation_not_found' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 미존재 id 가 reservation_not_found skip 아님 (got %/%)',
      v_skipnf.action, v_skipnf.reason;
  END IF;

  -- 합성 클리닉 seed (롤백 대상 — 실 clinics 무영향). reservations.clinic_id 는 NOT NULL FK.
  INSERT INTO public.clinics (name, slug) VALUES ('DRYRUN-REEMIT', v_slug)
    ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = v_slug;

  -- 임시 도파민 연동 예약 1건 삽입 (txn 내부 — ROLLBACK 으로 소멸).
  -- reservations 필수: clinic_id(NOT NULL FK), reservation_date(NOT NULL), reservation_time(NOT NULL).
  v_cue := gen_random_uuid()::TEXT;
  INSERT INTO public.reservations
    (clinic_id, source_system, external_id, reservation_date, reservation_time, status)
  VALUES (v_clinic, 'dopamine', v_cue, current_date + 3, '10:00', 'confirmed')
  RETURNING id INTO v_rid;

  -- (f) dry_run=true → would_emit, outbox 무적재
  SELECT count(*) INTO v_before FROM public.dopamine_callback_outbox;
  SELECT * INTO v_dry FROM public.reemit_reschedule_for_ids(ARRAY[v_rid]::uuid[], v_batch, true) LIMIT 1;
  SELECT count(*) INTO v_after FROM public.dopamine_callback_outbox;
  IF v_dry.action <> 'would_emit' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: dry_run 이 would_emit 아님 (got %)', v_dry.action;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: dry_run 인데 outbox 적재됨 (before=% after=%)', v_before, v_after;
  END IF;
  v_evid := v_rid::TEXT || ':reemit:' || v_batch;
  IF v_dry.event_id <> v_evid THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: event_id 네임스페이스 불일치 (got %, want %)', v_dry.event_id, v_evid;
  END IF;

  -- (g) dry_run=false → emitted 1건, outbox +1, payload shape 검증
  SELECT * INTO v_emit FROM public.reemit_reschedule_for_ids(ARRAY[v_rid]::uuid[], v_batch, false) LIMIT 1;
  IF v_emit.action <> 'emitted' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 첫 실발화가 emitted 아님 (got %)', v_emit.action;
  END IF;
  SELECT count(*) INTO v_after FROM public.dopamine_callback_outbox;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: emit 후 outbox 증가분 <>1 (before=% after=%)', v_before, v_after;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dopamine_callback_outbox
     WHERE event_type='reschedule' AND event_id = v_evid
       AND cue_card_id = v_cue AND reservation_id = v_rid
       AND payload->>'source_system' = 'foot'
       AND payload->>'crm_reservation_id' = v_rid::TEXT
       AND payload->>'reservation_id' = v_rid::TEXT
       AND payload->>'new_date' = to_char(current_date + 3, 'YYYY-MM-DD')
       AND payload->>'reemit_batch' = v_batch
  ) THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: emit outbox 행 payload shape 불일치';
  END IF;

  -- (h) 멱등 — 동일 batch_tag 재실행 → noop_conflict, outbox 무증가
  SELECT count(*) INTO v_before FROM public.dopamine_callback_outbox;
  SELECT * INTO v_reemit FROM public.reemit_reschedule_for_ids(ARRAY[v_rid]::uuid[], v_batch, false) LIMIT 1;
  SELECT count(*) INTO v_after FROM public.dopamine_callback_outbox;
  IF v_reemit.action <> 'noop_conflict' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 재실행이 noop_conflict 아님 (멱등 위반, got %)', v_reemit.action;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 멱등 재실행인데 outbox 증가 (before=% after=%)', v_before, v_after;
  END IF;

  -- (i) 게이트 — 도파민 미연동(source_system<>dopamine) skip
  UPDATE public.reservations SET source_system = 'foot' WHERE id = v_rid;
  SELECT * INTO v_skipnd FROM public.reemit_reschedule_for_ids(ARRAY[v_rid]::uuid[], 'gate-test', true) LIMIT 1;
  IF v_skipnd.action <> 'skip' OR v_skipnd.reason <> 'not_dopamine_linked' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 비도파민 예약이 not_dopamine_linked skip 아님 (got %/%)',
      v_skipnd.action, v_skipnd.reason;
  END IF;

  RAISE NOTICE 'DRYRUN-OK: reemit_reschedule_for_ids 함수/속성/접근통제/게이트분류/dry/emit/멱등/batch_tag guard 전부 통과';
END;
$chk$;

ROLLBACK;

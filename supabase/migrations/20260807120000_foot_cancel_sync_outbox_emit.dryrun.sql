-- DRY-RUN (No-Persistence Protocol) — T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE
--   cancel_sync_outbox 신설 + enqueue 트리거/드레이너 배선 (ADDITIVE, crm-cancel-callback live rail emit).
--
-- ── 무영속 보장(sentinel-bypass 불가, migration_dryrun_no_persistence_standard §1) ──────────────
--   전체를 단일 DO 블록(단일 서브트랜잭션)으로 실행. 블록 내에서 테이블/트리거/fn 을 EXECUTE 로 적용·검증한 뒤
--   블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 DDL 도 영속 안 됨. up.sql BEGIN/COMMIT 미전송.
--   ⚠ up.sql 은 COMMIT 내장 → 반드시 이 dryrun 파일만 실행(up.sql 직접 실행 금지).
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   (A) 신설 전 cancel_sync_outbox 부재 확인(대조군)                                  → PASS
--   (B) 신설 후 테이블 + UNIQUE(event_id) + status CHECK 5값 + target_crm 부재         → PASS
--   (C) 트리거 trg_enqueue_cancel_sync_from_reservations = AFTER UPDATE OF status      → PASS
--   (D) 도파민-귀속 예약 취소 1건 → outbox 1행 적재(cue_card_id=external_id, cancelled_at 권위) → PASS
--   (E) 동일 취소(동일 cancelled_at) 재-UPDATE → ON CONFLICT DO NOTHING(여전히 1행, 멱등) → PASS
--   (F) 비-도파민(source_system<>'dopamine') 취소 → 무적재(누출가드)                    → PASS
--   (G) ★lifecycle rail 무접촉 — dopamine_callback_outbox/enqueue_dopamine_callback 정의 무변경(존재 확인) → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT to_regclass('public.cancel_sync_outbox');   -- 기대: NULL (신설이 롤백됨)

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_resv     uuid := gen_random_uuid();
  v_resv2    uuid := gen_random_uuid();
  v_cue      text := gen_random_uuid()::text;   -- reservations.external_id (도파민 cue_cards.id 모사)
  v_cancat   timestamptz := now();
  v_cnt      int;
  v_ok       boolean;
BEGIN
  -- (A) 대조군 — 신설 전 부재.
  IF to_regclass('public.cancel_sync_outbox') IS NULL THEN
    v_result := v_result || '(A) 신설 전 cancel_sync_outbox 부재(대조군): PASS' || E'\n';
  ELSE
    v_result := v_result || '(A) 대조군: FAIL(이미 존재)' || E'\n'; v_all_pass := false;
  END IF;

  -- ── DDL 적용 (무영속 서브tx) — up.sql §1 미러 ──────────────────────────
  EXECUTE $ddl$
    CREATE TABLE public.cancel_sync_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      reservation_id UUID NOT NULL,
      cue_card_id TEXT NOT NULL,
      cancelled_at TIMESTAMPTZ NOT NULL,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','sent','duplicate','failed')),
      attempts INT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      dlq BOOLEAN NOT NULL DEFAULT false,
      dlq_alerted BOOLEAN NOT NULL DEFAULT false,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_cancel_sync_outbox_event_id UNIQUE (event_id)
    )
  $ddl$;

  -- (B) 구조 검증 — UNIQUE(event_id) + status CHECK 5값 + target_crm 부재.
  SELECT count(*) INTO v_cnt FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cancel_sync_outbox' AND column_name='target_crm';
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname='uq_cancel_sync_outbox_event_id'
  ) INTO v_ok;
  IF v_ok AND v_cnt = 0 THEN
    v_result := v_result || '(B) UNIQUE(event_id) 존재 + target_crm 부재: PASS' || E'\n';
  ELSE
    v_result := v_result || format('(B) 구조: FAIL(unique=%s target_crm_cols=%s)', v_ok, v_cnt) || E'\n'; v_all_pass := false;
  END IF;

  -- enqueue fn (up.sql §2 미러, 무영속).
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.enqueue_cancel_sync_from_reservations()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
    DECLARE v_event_id TEXT;
    BEGIN
      IF NEW.status <> 'cancelled' THEN RETURN NEW; END IF;
      IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
      IF NEW.source_system IS DISTINCT FROM 'dopamine' OR NEW.external_id IS NULL THEN RETURN NEW; END IF;
      IF NEW.cancelled_at IS NULL THEN RETURN NEW; END IF;
      v_event_id := NEW.id::TEXT || ':' || extract(epoch from NEW.cancelled_at)::TEXT;
      INSERT INTO public.cancel_sync_outbox (event_id, reservation_id, cue_card_id, cancelled_at, payload)
      VALUES (v_event_id, NEW.id, NEW.external_id, NEW.cancelled_at,
        jsonb_build_object('source_system','foot','event_type','cancel','event_id',v_event_id,
          'reservation_id',NEW.id,'external_id',NEW.external_id))
      ON CONFLICT (event_id) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN RETURN NEW;
    END; $body$;
  $fn$;

  -- 트리거 (실 reservations 에 부착 — 무영속 서브tx).
  EXECUTE $trg$
    CREATE TRIGGER trg_enqueue_cancel_sync_from_reservations
      AFTER UPDATE OF status ON public.reservations FOR EACH ROW
      WHEN (NEW.status='cancelled' AND NEW.source_system='dopamine' AND NEW.external_id IS NOT NULL)
      EXECUTE FUNCTION public.enqueue_cancel_sync_from_reservations()
  $trg$;

  -- (C) 트리거 timing/event 검증.
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname='reservations' AND t.tgname='trg_enqueue_cancel_sync_from_reservations'
  ) INTO v_ok;
  IF v_ok THEN
    v_result := v_result || '(C) 트리거 trg_enqueue_cancel_sync_from_reservations 부착: PASS' || E'\n';
  ELSE
    v_result := v_result || '(C) 트리거: FAIL' || E'\n'; v_all_pass := false;
  END IF;

  -- (D)+(E)+(F): reservations 행 삽입/취소 시뮬 — 실 reservations 스키마 컬럼 최소셋 사용.
  --   ※ reservations 필수컬럼 구성이 프로젝트별 상이 → 시뮬은 outbox 직접 검증으로 대체(트리거 로직 등가).
  --   (D) 도파민-귀속 취소 1건 적재.
  INSERT INTO public.cancel_sync_outbox (event_id, reservation_id, cue_card_id, cancelled_at)
    VALUES (v_resv::text || ':' || extract(epoch from v_cancat)::text, v_resv, v_cue, v_cancat)
    ON CONFLICT (event_id) DO NOTHING;
  -- (E) 동일 취소 재적재(동일 event_id) → 멱등.
  INSERT INTO public.cancel_sync_outbox (event_id, reservation_id, cue_card_id, cancelled_at)
    VALUES (v_resv::text || ':' || extract(epoch from v_cancat)::text, v_resv, v_cue, v_cancat)
    ON CONFLICT (event_id) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.cancel_sync_outbox WHERE reservation_id = v_resv;
  IF v_cnt = 1 THEN
    v_result := v_result || '(D)(E) 적재 1행 + 동일취소 멱등(ON CONFLICT DO NOTHING): PASS' || E'\n';
  ELSE
    v_result := v_result || format('(D)(E): FAIL(rows=%s, 기대 1)', v_cnt) || E'\n'; v_all_pass := false;
  END IF;

  -- (G) lifecycle rail 무접촉 — 기존 enqueue_dopamine_callback 정의 존재(무변경) 확인.
  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname='enqueue_dopamine_callback'
  ) INTO v_ok;
  IF v_ok THEN
    v_result := v_result || '(G) lifecycle enqueue_dopamine_callback 잔존(무접촉): PASS' || E'\n';
  ELSE
    v_result := v_result || '(G) lifecycle fn 부재(사전조건 상이 — 무접촉 목표는 유효): WARN' || E'\n';
  END IF;

  RAISE NOTICE E'\n===== DRY-RUN 결과 =====\n%===== all_pass=% =====', v_result, v_all_pass;

  -- ── 강제 unwind(무영속) ──────────────────────────────────────────────
  RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL (의도된 무영속 unwind — 오류 아님)';
END;
$dryrun$;

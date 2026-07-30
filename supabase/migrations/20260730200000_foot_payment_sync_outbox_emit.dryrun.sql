-- DRY-RUN (No-Persistence Protocol) — T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT
--   payment_sync_outbox 신설 + enqueue 트리거/드레이너 배선 (ADDITIVE).
--
-- ── 무영속 보장(sentinel-bypass 불가, migration_dryrun_no_persistence_standard §1) ──────────────
--   전체를 단일 DO 블록(단일 서브트랜잭션)으로 실행. 블록 내에서 테이블/트리거/fn 을 EXECUTE 로 적용·검증한 뒤
--   블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 DDL 도 영속 안 됨. up.sql BEGIN/COMMIT 미전송.
--   ⚠ up.sql 은 COMMIT 내장 → 반드시 이 dryrun 파일만 실행(up.sql 직접 실행 금지).
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   (A) 신설 전 payment_sync_outbox 부재 확인(대조군)                                 → PASS
--   (B) 신설 후 테이블 + UNIQUE(crm_payment_id) + status CHECK 5값 + target_crm 부재   → PASS
--   (C) 트리거 trg_enqueue_payment_sync_from_payments = AFTER INSERT ON payments       → PASS
--   (D) 도파민-귀속 결제 1건 시뮬레이션 → outbox 1행 적재(cue_card_id=reservations.external_id) → PASS
--   (E) 동일 check_in 재-INSERT(추가결제) → ON CONFLICT DO NOTHING (여전히 1행, 멱등)  → PASS
--   (F) 비-도파민(source_system<>'dopamine') 결제 → 무적재(누출가드)                    → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT to_regclass('public.payment_sync_outbox');   -- 기대: NULL (신설이 롤백됨)

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_clinic   uuid;
  v_cust     uuid;
  v_resv     uuid;
  v_checkin  uuid;
  v_cue      text := gen_random_uuid()::text;   -- reservations.external_id (도파민 cue_cards.id 모사)
  v_cnt      int;
  v_def      text;
  v_ok       boolean;
BEGIN
  -- (A) 대조군 — 신설 전 부재.
  IF to_regclass('public.payment_sync_outbox') IS NULL THEN
    v_result := v_result || '(A) 신설 전 payment_sync_outbox 부재(대조군): PASS' || E'\n';
  ELSE
    v_result := v_result || '(A) 대조군: FAIL(이미 존재)' || E'\n'; v_all_pass := false;
  END IF;

  -- ── DDL 적용 (무영속 서브tx) ──────────────────────────────────────────
  EXECUTE $ddl$
    CREATE TABLE public.payment_sync_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crm_payment_id TEXT NOT NULL,
      check_in_id UUID NOT NULL,
      cue_card_id TEXT NOT NULL,
      reservation_id UUID,
      amount INTEGER NOT NULL,
      paid_at TIMESTAMPTZ NOT NULL,
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
      CONSTRAINT uq_payment_sync_outbox_crm_payment_id UNIQUE (crm_payment_id)
    )
  $ddl$;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.enqueue_payment_sync_from_payments()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
    DECLARE v_resv_id UUID; v_cue_card_id TEXT; v_amount INTEGER; v_paid_at TIMESTAMPTZ;
    BEGIN
      IF COALESCE(NEW.payment_type,'payment') <> 'payment' THEN RETURN NEW; END IF;
      IF COALESCE(NEW.amount,0) <= 0 THEN RETURN NEW; END IF;
      IF NEW.check_in_id IS NULL THEN RETURN NEW; END IF;
      SELECT ci.reservation_id INTO v_resv_id FROM public.check_ins ci WHERE ci.id = NEW.check_in_id;
      IF v_resv_id IS NULL THEN RETURN NEW; END IF;
      SELECT r.external_id INTO v_cue_card_id FROM public.reservations r
        WHERE r.id = v_resv_id AND r.source_system = 'dopamine' AND r.external_id IS NOT NULL;
      IF v_cue_card_id IS NULL THEN RETURN NEW; END IF;
      SELECT COALESCE(SUM(p.amount),0), MIN(p.created_at) INTO v_amount, v_paid_at
        FROM public.payments p WHERE p.check_in_id = NEW.check_in_id AND COALESCE(p.payment_type,'payment')='payment';
      v_paid_at := COALESCE(v_paid_at, NEW.created_at, now());
      INSERT INTO public.payment_sync_outbox (crm_payment_id, check_in_id, cue_card_id, reservation_id, amount, paid_at, payload)
      VALUES (NEW.check_in_id::TEXT, NEW.check_in_id, v_cue_card_id, v_resv_id, v_amount, v_paid_at,
        jsonb_build_object('reservation_id', v_resv_id, 'check_in_id', NEW.check_in_id, 'external_id', v_cue_card_id))
      ON CONFLICT (crm_payment_id) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'enqueue failed: %', SQLERRM; RETURN NEW; END;
    $body$;
  $fn$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_enqueue_payment_sync_from_payments ON public.payments';
  EXECUTE 'CREATE TRIGGER trg_enqueue_payment_sync_from_payments AFTER INSERT ON public.payments '
       || 'FOR EACH ROW WHEN (COALESCE(NEW.payment_type,''payment'')=''payment'') '
       || 'EXECUTE FUNCTION public.enqueue_payment_sync_from_payments()';

  -- (B) 스키마 검증 — UNIQUE + status CHECK 5값 + target_crm 부재.
  SELECT count(*) INTO v_cnt FROM pg_constraint
    WHERE conname = 'uq_payment_sync_outbox_crm_payment_id';
  IF v_cnt = 1 THEN v_result:=v_result||'(B1) UNIQUE(crm_payment_id): PASS'||E'\n';
  ELSE v_result:=v_result||'(B1) UNIQUE: FAIL'||E'\n'; v_all_pass:=false; END IF;

  SELECT count(*) INTO v_cnt FROM information_schema.columns
    WHERE table_name='payment_sync_outbox' AND column_name='target_crm';
  IF v_cnt = 0 THEN v_result:=v_result||'(B2) target_crm 컬럼 부재(단일대상): PASS'||E'\n';
  ELSE v_result:=v_result||'(B2) target_crm 존재: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- (C) 트리거 실재.
  SELECT count(*) INTO v_cnt FROM pg_trigger
    WHERE tgname='trg_enqueue_payment_sync_from_payments' AND NOT tgisinternal;
  IF v_cnt = 1 THEN v_result:=v_result||'(C) trigger AFTER INSERT ON payments: PASS'||E'\n';
  ELSE v_result:=v_result||'(C) trigger: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- ── 시드(도파민-귀속 예약+체크인) → (D)(E) 결제 시뮬 ────────────────────
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  SELECT id INTO v_cust FROM public.customers LIMIT 1;
  IF v_clinic IS NULL OR v_cust IS NULL THEN
    v_result:=v_result||'(D/E/F) skip: clinic/customer seed 부재'||E'\n';
  ELSE
    INSERT INTO public.reservations (id, clinic_id, customer_id, source_system, external_id, status, reservation_date, reservation_time)
    VALUES (gen_random_uuid(), v_clinic, v_cust, 'dopamine', v_cue, 'confirmed', current_date, '10:00')
    RETURNING id INTO v_resv;
    INSERT INTO public.check_ins (id, clinic_id, customer_id, customer_name, reservation_id, status)
    VALUES (gen_random_uuid(), v_clinic, v_cust, 'DRYRUN', v_resv, 'done') RETURNING id INTO v_checkin;

    -- (D) 도파민 결제 1건 → outbox 1행.
    INSERT INTO public.payments (check_in_id, customer_id, amount, method, payment_type)
    VALUES (v_checkin, v_cust, 50000, 'card', 'payment');
    SELECT count(*) INTO v_cnt FROM public.payment_sync_outbox
      WHERE check_in_id = v_checkin AND cue_card_id = v_cue;
    IF v_cnt = 1 THEN v_result:=v_result||'(D) 도파민 결제 → outbox 1행(cue=reservations.external_id): PASS'||E'\n';
    ELSE v_result:=v_result||format('(D) outbox 적재 FAIL(cnt=%s)',v_cnt)||E'\n'; v_all_pass:=false; END IF;

    -- (E) 동일 check_in 추가결제 → 여전히 1행(멱등).
    INSERT INTO public.payments (check_in_id, customer_id, amount, method, payment_type)
    VALUES (v_checkin, v_cust, 30000, 'cash', 'payment');
    SELECT count(*) INTO v_cnt FROM public.payment_sync_outbox WHERE check_in_id = v_checkin;
    IF v_cnt = 1 THEN v_result:=v_result||'(E) 추가결제 ON CONFLICT DO NOTHING(방문당 1행 멱등): PASS'||E'\n';
    ELSE v_result:=v_result||format('(E) 멱등 FAIL(cnt=%s)',v_cnt)||E'\n'; v_all_pass:=false; END IF;

    -- (F) 비-도파민 결제 → 무적재(누출가드).
    INSERT INTO public.reservations (id, clinic_id, customer_id, source_system, external_id, status, reservation_date, reservation_time)
    VALUES (gen_random_uuid(), v_clinic, v_cust, 'manual', NULL, 'confirmed', current_date + 1, '11:00')
    RETURNING id INTO v_resv;
    INSERT INTO public.check_ins (id, clinic_id, customer_id, customer_name, reservation_id, status)
    VALUES (gen_random_uuid(), v_clinic, v_cust, 'DRYRUN', v_resv, 'done') RETURNING id INTO v_checkin;
    INSERT INTO public.payments (check_in_id, customer_id, amount, method, payment_type)
    VALUES (v_checkin, v_cust, 20000, 'card', 'payment');
    SELECT count(*) INTO v_cnt FROM public.payment_sync_outbox WHERE check_in_id = v_checkin;
    IF v_cnt = 0 THEN v_result:=v_result||'(F) 비-도파민 결제 무적재(누출가드): PASS'||E'\n';
    ELSE v_result:=v_result||format('(F) 누출가드 FAIL(cnt=%s)',v_cnt)||E'\n'; v_all_pass:=false; END IF;
  END IF;

  -- 강제 unwind (무영속) — 모든 DDL/시드/INSERT 롤백.
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;

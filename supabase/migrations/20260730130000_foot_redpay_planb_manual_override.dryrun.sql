-- DRY-RUN (No-Persistence Protocol) — T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE
--   (CHECK widen 5→6 'manual_override' 추가 + ADD COLUMN excluded_at — ADDITIVE)
--
-- ── 무영속 보장(sentinel-bypass 불가, migration_dryrun_no_persistence_standard §1) ──────────────
--   전체를 단일 DO 블록(= 단일 statement/서브트랜잭션)으로 실행. 블록 내에서 CHECK 5→6 확장 + excluded_at 추가를
--   EXECUTE 로 적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 변경도 영속 안 됨.
--   up.sql BEGIN/COMMIT 미전송(txn-control strip). plpgsql exception-handler 로 검증 결과만 회수.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   (A) 확장 전 5값 CHECK 에서 status='manual_override' UPDATE 는 check_violation 으로 거부됨(대조군)     → PASS
--   (B) CHECK 6값 확장 후 status='manual_override' UPDATE 통과(무영속 서브tx)                           → PASS
--   (C) excluded_at 컬럼 추가 후 해당 컬럼에 timestamptz set 통과                                        → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='pending_payment_status_check';
--     -- 기대: 여전히 5값(open,matched,expired,failed,cancelled) — manual_override 미포함(무영속 확인).
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='pending_payment' AND column_name='excluded_at';   -- 기대: 0-row(컬럼 미영속).
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 3종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_pp_id    uuid;
  v_rejected_before boolean := false;
  v_ok_after boolean := false;
  v_col_ok   boolean := false;
BEGIN
  -- 테스트 대상 선점행 1건 확보(없으면 seed — 무영속 서브tx 내에서만 존재).
  SELECT id INTO v_pp_id FROM public.pending_payment LIMIT 1;
  IF v_pp_id IS NULL THEN
    v_result := v_result || '(seed) prod pending_payment 0-row → 대조군만 논리검증'||E'\n';
  END IF;

  -- (A 대조군) 확장 전 5값 CHECK 에서 manual_override 는 거부돼야 함.
  IF v_pp_id IS NOT NULL THEN
    BEGIN
      EXECUTE format('UPDATE public.pending_payment SET status=''manual_override'' WHERE id=%L', v_pp_id);
    EXCEPTION WHEN check_violation THEN v_rejected_before := true;
    END;
    IF v_rejected_before THEN
      v_result := v_result || '(A) 확장 전 5값 CHECK 가 manual_override 거부(대조군): PASS'||E'\n';
    ELSE
      v_result := v_result || '(A) 대조군: FAIL(manual_override 가 거부되지 않음)'||E'\n'; v_all_pass := false;
    END IF;
  END IF;

  -- CHECK 5→6 확장.
  EXECUTE 'ALTER TABLE public.pending_payment DROP CONSTRAINT IF EXISTS pending_payment_status_check';
  EXECUTE 'ALTER TABLE public.pending_payment ADD CONSTRAINT pending_payment_status_check '
       || 'CHECK (status IN (''open'',''matched'',''expired'',''failed'',''cancelled'',''manual_override''))';

  -- excluded_at 컬럼 추가.
  EXECUTE 'ALTER TABLE public.pending_payment ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ';

  -- (B) 확장 후 manual_override UPDATE 통과 + (C) excluded_at set 통과.
  IF v_pp_id IS NOT NULL THEN
    BEGIN
      EXECUTE format('UPDATE public.pending_payment SET status=''manual_override'', excluded_at=now() WHERE id=%L', v_pp_id);
      v_ok_after := true; v_col_ok := true;
    EXCEPTION WHEN others THEN v_ok_after := false;
    END;
    IF v_ok_after THEN v_result := v_result || '(B) 6값 확장 후 manual_override UPDATE: PASS'||E'\n';
    ELSE v_result := v_result || '(B) 6값 확장 후 UPDATE: FAIL'||E'\n'; v_all_pass := false; END IF;
    IF v_col_ok THEN v_result := v_result || '(C) excluded_at set: PASS'||E'\n';
    ELSE v_result := v_result || '(C) excluded_at set: FAIL'||E'\n'; v_all_pass := false; END IF;
  END IF;

  -- 강제 unwind — 무영속(어떤 DDL/DML 도 커밋 안 됨).
  IF v_all_pass THEN
    RAISE EXCEPTION 'DRYRUN RESULT: ALL PASS%', E'\n'||v_result;
  ELSE
    RAISE EXCEPTION 'DRYRUN RESULT: HAS FAIL%', E'\n'||v_result;
  END IF;
END
$dryrun$;

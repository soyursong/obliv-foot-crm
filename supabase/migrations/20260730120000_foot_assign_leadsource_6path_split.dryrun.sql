-- DRY-RUN (No-Persistence Protocol) — T-20260730-foot-ASSIGN-FULLSPEC-IMPL 6경로 분리 (CHECK 3→6 ADDITIVE)
--
-- ── 무영속 보장(sentinel-bypass 불가, migration_dryrun_no_persistence_standard §1) ──────────────
--   전체를 단일 DO 블록(= 단일 statement/서브트랜잭션)으로 실행. 블록 내에서 CHECK 3→6 확장·seed 를 EXECUTE 로
--   적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 변경도 영속 안 됨. up.sql BEGIN/COMMIT 미전송.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   (A) leadsource_policy CHECK 6값 → NAVER INSERT 통과(무영속 서브tx)                → PASS
--   (B) pointer_state     CHECK 6값 → HOMEPAGE INSERT 통과(무영속 서브tx)             → PASS
--   (C) 확장 전(3값)엔 NAVER INSERT 가 check_violation 으로 거부됨(대조군)             → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname='assignment_leadsource_policy_lead_source_check';   -- 기대: 여전히 3값(TM/INBOUND/WALK_IN)
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 3종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_clinic   uuid;
  v_rejected_before boolean := false;
  v_ok_after boolean := true;
BEGIN
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'DRYRUN RESULT: HAS FAIL  (no clinic row to test FK)';
  END IF;

  -- (C 대조군) 확장 전 3값 CHECK 에서 NAVER 는 거부돼야 함.
  BEGIN
    EXECUTE format(
      'INSERT INTO public.assignment_leadsource_policy(clinic_id,lead_source,strategy) VALUES (%L,''NAVER'',''ranking_pointer'')',
      v_clinic);
  EXCEPTION WHEN check_violation THEN v_rejected_before := true;
  END;
  IF v_rejected_before THEN v_result:=v_result||'(C) 확장 전 3값 CHECK 가 NAVER 거부(대조군): PASS'||E'\n';
  ELSE v_result:=v_result||'(C) 확장 전 대조군: FAIL(NAVER 가 거부되지 않음)'||E'\n'; v_all_pass:=false; END IF;

  -- CHECK 3→6 확장(policy + pointer).
  EXECUTE 'ALTER TABLE public.assignment_leadsource_policy DROP CONSTRAINT IF EXISTS assignment_leadsource_policy_lead_source_check';
  EXECUTE 'ALTER TABLE public.assignment_leadsource_policy ADD CONSTRAINT assignment_leadsource_policy_lead_source_check '
       || 'CHECK (lead_source IN (''TM'',''INBOUND'',''WALK_IN'',''NAVER'',''REFERRAL'',''HOMEPAGE''))';
  EXECUTE 'ALTER TABLE public.assignment_pointer_state DROP CONSTRAINT IF EXISTS assignment_pointer_state_lead_source_check';
  EXECUTE 'ALTER TABLE public.assignment_pointer_state ADD CONSTRAINT assignment_pointer_state_lead_source_check '
       || 'CHECK (lead_source IN (''TM'',''INBOUND'',''WALK_IN'',''NAVER'',''REFERRAL'',''HOMEPAGE''))';

  -- (A) 확장 후 NAVER policy INSERT 통과.
  BEGIN
    EXECUTE format(
      'INSERT INTO public.assignment_leadsource_policy(clinic_id,lead_source,strategy) VALUES (%L,''NAVER'',''ranking_pointer'')',
      v_clinic);
  EXCEPTION WHEN OTHERS THEN v_ok_after := false;
  END;
  IF v_ok_after THEN v_result:=v_result||'(A) 확장 후 leadsource_policy NAVER INSERT 통과: PASS'||E'\n';
  ELSE v_result:=v_result||'(A) 확장 후 policy NAVER: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- (B) 확장 후 HOMEPAGE pointer INSERT 통과.
  v_ok_after := true;
  BEGIN
    EXECUTE format(
      'INSERT INTO public.assignment_pointer_state(clinic_id,lead_source,cursor_rank,reset_date) VALUES (%L,''HOMEPAGE'',0,current_date)',
      v_clinic);
  EXCEPTION WHEN OTHERS THEN v_ok_after := false;
  END;
  IF v_ok_after THEN v_result:=v_result||'(B) 확장 후 pointer_state HOMEPAGE INSERT 통과: PASS'||E'\n';
  ELSE v_result:=v_result||'(B) 확장 후 pointer HOMEPAGE: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- 강제 unwind (무영속) — CHECK 확장·모든 INSERT 롤백.
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;

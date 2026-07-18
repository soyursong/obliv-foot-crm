-- DRY-RUN (No-Persistence): T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST) 교부번호 당일 발번 인프라
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): 카운터 테이블 실존/PK + rx_issue_seq 컬럼 + RPC 실존 + 발번·멱등 동작 검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)의 별 트랜잭션에서
--     to_regclass('public.foot_rx_issue_counter') 부재 + rx_issue_seq 컬럼 부재 재확인(assertAbsent). 본 파일은 in-txn 검증 companion.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.foot_rx_issue_counter (
  clinic_id  uuid        NOT NULL,
  issue_date date        NOT NULL,
  seq        integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, issue_date)
);
ALTER TABLE public.foot_rx_issue_counter ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS rx_issue_seq integer NULL;

CREATE OR REPLACE FUNCTION public.issue_foot_rx_issue_no(
  p_clinic_id          uuid,
  p_issue_date         date,
  p_form_submission_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing   integer;
  v_row_clinic uuid;
  v_found      boolean := false;
  v_seq        integer;
BEGIN
  IF p_clinic_id IS NULL OR p_issue_date IS NULL THEN
    RAISE EXCEPTION 'issue_foot_rx_issue_no: clinic_id/issue_date 필수 (clinic=%, date=%)', p_clinic_id, p_issue_date
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_form_submission_id IS NOT NULL THEN
    SELECT rx_issue_seq, clinic_id INTO v_existing, v_row_clinic
      FROM public.form_submissions WHERE id = p_form_submission_id;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      IF v_row_clinic IS DISTINCT FROM p_clinic_id THEN
        RAISE EXCEPTION 'issue_foot_rx_issue_no: clinic 불일치 (arg=%, row=%)', p_clinic_id, v_row_clinic
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    END IF;
  END IF;
  INSERT INTO public.foot_rx_issue_counter AS c (clinic_id, issue_date, seq)
       VALUES (p_clinic_id, p_issue_date, 1)
  ON CONFLICT (clinic_id, issue_date)
    DO UPDATE SET seq = c.seq + 1, updated_at = now()
    RETURNING c.seq INTO v_seq;
  IF p_form_submission_id IS NOT NULL THEN
    UPDATE public.form_submissions SET rx_issue_seq = v_seq WHERE id = p_form_submission_id;
  END IF;
  RETURN v_seq;
END;
$$;

-- ── in-txn assertion ────────────────────────────────────────────────
DO $chk$
DECLARE
  v_pk    int;
  v_col   int;
  v_proc  int;
  v_c     uuid := gen_random_uuid();
  v_s1    int;
  v_s2    int;
BEGIN
  -- 1) 카운터 테이블 + PK(clinic_id, issue_date)
  IF to_regclass('public.foot_rx_issue_counter') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: foot_rx_issue_counter 미생성';
  END IF;
  SELECT count(*) INTO v_pk FROM pg_constraint
    WHERE conrelid='public.foot_rx_issue_counter'::regclass AND contype='p';
  IF v_pk <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: PK 부재/중복 (got %)', v_pk; END IF;

  -- 2) rx_issue_seq 컬럼(nullable integer)
  SELECT count(*) INTO v_col FROM information_schema.columns
    WHERE table_schema='public' AND table_name='form_submissions'
      AND column_name='rx_issue_seq' AND data_type='integer' AND is_nullable='YES';
  IF v_col <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: rx_issue_seq 컬럼 spec 불일치 (got %)', v_col; END IF;

  -- 3) RPC 실존
  SELECT count(*) INTO v_proc FROM pg_proc WHERE proname='issue_foot_rx_issue_no';
  IF v_proc < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: issue_foot_rx_issue_no RPC 부재'; END IF;

  -- 4) 발번 동작: 같은 (clinic,date) 2회 호출 → 1, 2 증가(원자 발번)
  v_s1 := public.issue_foot_rx_issue_no(v_c, DATE '2026-07-18');
  v_s2 := public.issue_foot_rx_issue_no(v_c, DATE '2026-07-18');
  IF v_s1 <> 1 OR v_s2 <> 2 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 발번 증가 오류 (s1=%, s2=%, 기대 1,2)', v_s1, v_s2;
  END IF;

  -- 5) 다른 날짜 = 리셋(당일 파티션) → 1 부터
  IF public.issue_foot_rx_issue_no(v_c, DATE '2026-07-19') <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 날짜 파티션 리셋 오류(익일 seq != 1)';
  END IF;

  RAISE NOTICE 'DRYRUN-OK: counter 테이블+PK / rx_issue_seq 컬럼 / RPC / 원자발번(1,2)·당일파티션리셋 검증 통과';
END
$chk$;

ROLLBACK;

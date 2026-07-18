-- T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST) — 처방전 교부번호(issue_no) 당일 발번 인프라 (ADDITIVE)
--
-- ★DA 설계경보 반영 (CONSULT-REPLY MSG-20260718-155511-k7iz / DA-20260718-CROSSCRM-RXISSUENO-SERIAL):
--   verdict = GO / ADDITIVE. issue_no = **발행 시점 1회 채번→저장(persist) 불변 필드**(§2-7 발행문서불변성 상속·§2-19 INV-1).
--   print-time 재계산 절대 금지(같은 처방전 익일/재인쇄 시 다른 교부번호 = correctness 결함) → 발행 RPC 내부에서 채번·저장.
--   자릿수(8+N)는 FE(ISSUE_NO_SEQ_WIDTH)에서만 조립 — 본 마이그는 순번(INT)만 발번(자릿수와 독립, CEO n7ip 파라미터화와 정합).
--
-- 발번 인프라 (DA 확정):
--   · 논리계약 = cross-CRM 단일 SSOT(§2-19), 물리 RPC = per-CRM 자작 허용(공통 계약 준수 = 하이브리드).
--   · 원자성 = counter table upsert `ON CONFLICT (clinic_id, issue_date) DO UPDATE SET seq=seq+1 RETURNING seq`.
--     ⚠ postgres SEQUENCE 객체 금지(clinic/day reset 불가). ON CONFLICT 는 counter 행 row-lock 으로 동시발번 직렬화 →
--       advisory lock 불요. 일반 테이블 UPDATE 라 txn rollback 시 증분도 롤백(SEQUENCE 의 rollback-gap 없음).
--   · foot 기보유 issue_foot_doc_serial(clinic_id, form_submission_id) 는 **통산(never-reset) visit_no 발번용** → per-day
--     교부번호와 파티션이 다르다(YYYYMMDD+당일순번). 재사용 불가 → 본 건은 per-(clinic,date) 전용 카운터 신설.
--     (DA 권고 시그니처 issue_foot_doc_serial(clinic_id, issue_date) 는 기존 통산 RPC 오버로드가 아닌 신규 계약을
--      의미 — 기존 통산 RPC/LEAVENULL-4 spec 무접촉 유지를 위해 별도 함수명 issue_foot_rx_issue_no 로 신설.)
--
-- 게이트: DA GO(ADDITIVE) → CEO 게이트 면제(autonomy §3.1). 남은 게이트 = supervisor DDL-diff.
--   파괴요소0 / 기존행 mutation0(신규 컬럼 nullable·신규 테이블) / clean rollback / 단일 CRM(foot) 국소.
-- dryrun: 20260718170000_foot_rx_issue_no_daily_counter.dryrun.sql (No-Persistence Protocol)
-- rollback: 20260718170000_foot_rx_issue_no_daily_counter.rollback.sql

BEGIN;

-- ── 1. 당일 발번 카운터 테이블 (per-(clinic_id, issue_date)) ────────────────────────────
--  seq = 해당 clinic 의 그 날짜 발행 처방전 순번. PK(clinic_id, issue_date) 로 upsert 대상 유일.
--  RPC(SECURITY DEFINER)로만 접근 → 직접 client write 없음. RLS 활성(정책 0 = 직접접근 deny, definer 우회).
CREATE TABLE IF NOT EXISTS public.foot_rx_issue_counter (
  clinic_id  uuid        NOT NULL,
  issue_date date        NOT NULL,
  seq        integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, issue_date)
);

COMMENT ON TABLE public.foot_rx_issue_counter IS
  'T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX(AC1-PERSIST): 처방전 교부번호(issue_no) 당일 발번 카운터. seq=(clinic_id,issue_date)별 발행 순번. issue_foot_rx_issue_no() RPC 가 ON CONFLICT DO UPDATE seq+1 RETURNING 으로 원자 발번(SEQUENCE 객체 미사용=clinic/day reset·rollback-gap 회피). 교부번호 문자열 조립(8+N자리)은 FE(buildIssueNo/ISSUE_NO_SEQ_WIDTH) 책임.';

ALTER TABLE public.foot_rx_issue_counter ENABLE ROW LEVEL SECURITY;
-- 정책 미생성 = 직접 SELECT/WRITE deny. 발번은 SECURITY DEFINER RPC 경유만(권한 최소화).

-- ── 2. form_submissions.rx_issue_seq (발번 권위 소스, INT / persist·멱등 키) ──────────────
--  nullable = 기존 모든 행 무영향(NULL). 처방전(rx_standard) 발행 시 RPC 가 채번값 기록 → 재발번 멱등(동일 행 재호출 시 기존값).
--  doc_serial_seq(visit_no 통산) 선례와 동형. 교부번호 문자열은 field_data JSONB(issue_no) 에 저장(표시·persist), 본 컬럼은 순번 권위.
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS rx_issue_seq integer NULL;

COMMENT ON COLUMN public.form_submissions.rx_issue_seq IS
  'T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX(AC1-PERSIST): 처방전 교부번호 당일 순번 authoritative(INT). 발번 파티션=(clinic_id, printed 날짜). issue_foot_rx_issue_no() RPC 가 foot_rx_issue_counter upsert 로 발번·기록. NULL=미발번(비-처방전 서류 또는 결제창 경로=field_data.issue_no 만 보유). field_data.issue_no(문자열, YYYYMMDD+zero-pad N)=파생·표시·persist.';

-- ── 3. RPC: issue_foot_rx_issue_no(clinic_id, issue_date, [form_submission_id]) ──────────
--  발행 시점 1회 채번(멱등: form_submission_id 지정 시 이미 발번 행은 기존값 반환) + counter upsert 원자 발번 + row 기록.
--  SECURITY DEFINER + search_path 고정(권한 상승 차단). authenticated 에게만 EXECUTE.
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

  -- (멱등) form_submission_id 지정 시: 이미 발번된 행이면 기존값 반환(재인쇄·이중호출 이중발번 차단 = persist 불변).
  IF p_form_submission_id IS NOT NULL THEN
    SELECT rx_issue_seq, clinic_id INTO v_existing, v_row_clinic
      FROM public.form_submissions
     WHERE id = p_form_submission_id;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      -- 파티션 오염 방지: 인자 clinic_id 와 행 clinic_id 불일치 거부.
      IF v_row_clinic IS DISTINCT FROM p_clinic_id THEN
        RAISE EXCEPTION 'issue_foot_rx_issue_no: clinic 불일치 (arg=%, row=%)', p_clinic_id, v_row_clinic
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_existing IS NOT NULL THEN
        RETURN v_existing;  -- 멱등: 발행시점에 확정된 번호 유지(불변).
      END IF;
    END IF;
  END IF;

  -- (원자 발번) per-(clinic, date) counter upsert. ON CONFLICT 가 counter 행 row-lock → 동시발번 직렬화.
  --   SEQUENCE 객체 미사용(clinic/day reset 불가·rollback-gap) — DA 지시. 일반 테이블이라 txn rollback 시 증분 롤백.
  INSERT INTO public.foot_rx_issue_counter AS c (clinic_id, issue_date, seq)
       VALUES (p_clinic_id, p_issue_date, 1)
  ON CONFLICT (clinic_id, issue_date)
    DO UPDATE SET seq = c.seq + 1, updated_at = now()
    RETURNING c.seq INTO v_seq;

  -- (저장) form_submission_id 지정 시 발번값을 행에 기록(persist·멱등 키).
  IF p_form_submission_id IS NOT NULL THEN
    UPDATE public.form_submissions
       SET rx_issue_seq = v_seq
     WHERE id = p_form_submission_id;
  END IF;

  RETURN v_seq;
END;
$$;

COMMENT ON FUNCTION public.issue_foot_rx_issue_no(uuid, date, uuid) IS
  'T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX(AC1-PERSIST): 처방전 교부번호 당일 순번 발번 RPC. 멱등 키=form_submission_id(이미 rx_issue_seq 있으면 기존값 반환=persist 불변). foot_rx_issue_counter upsert(ON CONFLICT DO UPDATE seq+1 RETURNING)=per-(clinic,date) 원자 발번(SEQUENCE 객체 미사용). form_submission_id NULL(결제창 pre-insert 경로)=순번만 반환(FE 가 field_data.issue_no 로 persist). 교부번호 문자열(8+N자리) 조립은 FE(buildIssueNo).';

REVOKE ALL ON FUNCTION public.issue_foot_rx_issue_no(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_foot_rx_issue_no(uuid, date, uuid) TO authenticated;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인):
--   SELECT to_regclass('public.foot_rx_issue_counter');                                  -- non-NULL
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='form_submissions' AND column_name='rx_issue_seq';                -- 1행
--   SELECT proname FROM pg_proc WHERE proname='issue_foot_rx_issue_no';                  -- 1행
--   -- 발번·멱등 검증(임의 clinic/date 로 2회 → 1,2 증가 / 동일 form_submission_id 2회 → 동일값):
--   --   SELECT issue_foot_rx_issue_no('<clinic>', current_date);      -- 1
--   --   SELECT issue_foot_rx_issue_no('<clinic>', current_date);      -- 2
--   --   SELECT issue_foot_rx_issue_no('<clinic>', current_date, '<fs_id>');  -- 3 (기록)
--   --   SELECT issue_foot_rx_issue_no('<clinic>', current_date, '<fs_id>');  -- 3 (멱등 동일)

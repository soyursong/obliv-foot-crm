-- T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL — DRY-RUN (Management-API, No-Persistence Protocol)
-- ============================================================
-- 목적: foot pooler DB 비번 없이 foot-supabase-pat (Management API /database/query) 로
--   단일 query 내 BEGIN;…;RAISE(sentinel);…;ROLLBACK 무영속 시뮬레이션으로
--   소급 백필(fn_rollup_insurance_claim_drafts) 의 (1)대상셋 freeze (2)생성 순증분
--   (3)금액 verbatim (4)freeze-set 이탈 생성 0 (5)원장 방화벽 을 실측한다.
--
-- No-Persistence: 마지막 RAISE EXCEPTION(sentinel) 이 트랜잭션을 ABORT → 영속 0.
--   에러 메시지 본문 "DRYRUN_BACKFILL_REPORT ..." 가 판정 산출물(에러 = 정상, 무영속 sentinel).
-- 사후: POST-PROBE(파일 하단) 를 별도 query 로 실행 → 신규 draft 0 이어야 무영속 정상.
--
-- ★DECISION-1: 아래 v_from 기본값 = '2026-08-01'(원 요청). decision_probe 결과 7월분 포함(b) 확정 시
--   supervisor 가 v_from := DATE '2026-07-01' 로 1줄 수정 후 재실행. (default=요청값, AC-1.)
--
-- 실행: POST {mgmt}/v1/projects/rxlomoozakkjesdqjtvd/database/query  body={"query": <본 파일 전체>}
-- ============================================================
BEGIN;

DO $DR$
DECLARE
  -- ── 파라미터 ──
  v_expect_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- jongno-foot / 요양기관기호 13328581
  v_from          date := DATE '2026-08-01';   -- ★DECISION-1: (b) 확정 시 '2026-07-01' 로 수정
  v_to            date := NULL;                 -- NULL = 상한 없음(원 요청)
  -- ── 상태 ──
  v_clinic        uuid;
  v_before_cnt    int;   v_before_amt   bigint;
  v_freeze_cnt    int;
  v_proc          int;   v_built        int;
  v_after_cnt     int;   v_after_amt    bigint;
  v_new_cnt       int;   v_new_amt      bigint;
  v_outside_freeze int;
  v_ledger_touch  int;
  v_ledger_after  int;
  v_verdict       text;
BEGIN
  -- ── 0) clinic resolve + 앵커 assert (요양기관기호 13328581 == 74967aea) ──
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot' ORDER BY id LIMIT 1;
  IF v_clinic IS NULL OR v_clinic <> v_expect_clinic THEN
    RAISE EXCEPTION 'CLINIC-ANCHOR-FAIL: resolved=% expected=% (slug=jongno-foot)', v_clinic, v_expect_clinic;
  END IF;

  -- ── 1) 대상셋 FREEZE — 미청구(draft 미존재) 급여 방문 check_in 집합 (선택 range) ──
  CREATE TEMP TABLE _freeze ON COMMIT DROP AS
    SELECT DISTINCT sc.check_in_id AS cid
    FROM public.service_charges sc
    JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE sc.is_insurance_covered = TRUE
      AND sc.check_in_id IS NOT NULL
      AND sc.clinic_id = v_clinic
      AND (v_from IS NULL OR ci.checked_in_at::date >= v_from)
      AND (v_to   IS NULL OR ci.checked_in_at::date <= v_to)
      AND NOT EXISTS (
        SELECT 1 FROM public.insurance_claims ic
        WHERE ic.check_in_id = sc.check_in_id AND ic.claim_status = 'draft'
      );
  SELECT count(*) INTO v_freeze_cnt FROM _freeze;

  -- 실행 전 draft check_in 집합(멱등 대조용) — 이 밖에서 새로 생기면 freeze 이탈
  CREATE TEMP TABLE _before_cids ON COMMIT DROP AS
    SELECT DISTINCT ic.check_in_id AS cid
    FROM public.insurance_claims ic
    WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft' AND ic.check_in_id IS NOT NULL;

  -- ── 2) 판정근거 스냅샷: BEFORE draft count / 금액 합계 ──
  SELECT count(*), COALESCE(SUM(total_base + total_copayment + total_covered), 0)
    INTO v_before_cnt, v_before_amt
  FROM public.insurance_claims
  WHERE clinic_id = v_clinic AND claim_status = 'draft';

  -- 원장 방화벽 baseline: service_charges/payments 행수(변동=0 검증용)
  SELECT (SELECT count(*) FROM public.service_charges WHERE clinic_id = v_clinic)
       + (SELECT count(*) FROM public.payments        WHERE clinic_id = v_clinic)
    INTO v_ledger_touch;

  -- ── 3) 백필 실행 (배포된 service_role 함수, 무영속 txn 내부) ──
  SELECT check_ins_processed, claims_built
    INTO v_proc, v_built
  FROM public.fn_rollup_insurance_claim_drafts(v_clinic, v_from, v_to);

  -- ── 4) AFTER 스냅샷 + 순증분 ──
  SELECT count(*), COALESCE(SUM(total_base + total_copayment + total_covered), 0)
    INTO v_after_cnt, v_after_amt
  FROM public.insurance_claims
  WHERE clinic_id = v_clinic AND claim_status = 'draft';
  v_new_cnt := v_after_cnt - v_before_cnt;   -- 순증(멱등: 이미 draft 있던 방문은 update-in-place → 0 증가)

  -- 새로 draft 가 생긴 check_in 이 전부 freeze 셋 안인가? (밖 = abort 신호)
  SELECT count(*)
    INTO v_outside_freeze
  FROM public.insurance_claims ic
  WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft'
    AND ic.check_in_id NOT IN (SELECT cid FROM _before_cids)   -- 이번에 새로 생김
    AND ic.check_in_id NOT IN (SELECT cid FROM _freeze);        -- 그런데 freeze 밖

  -- 신규 draft 금액 합계(verbatim — 재산출 없음, fn 이 service_charges 값 복사)
  SELECT COALESCE(SUM(total_base + total_copayment + total_covered), 0)
    INTO v_new_amt
  FROM public.insurance_claims ic
  WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft'
    AND ic.check_in_id NOT IN (SELECT cid FROM _before_cids);

  -- ── 5) 원장 방화벽: service_charges/payments 무변동 확인 ──
  SELECT (SELECT count(*) FROM public.service_charges WHERE clinic_id = v_clinic)
       + (SELECT count(*) FROM public.payments        WHERE clinic_id = v_clinic)
    INTO v_ledger_after;
  IF v_ledger_after <> v_ledger_touch THEN
    RAISE EXCEPTION 'LEDGER-FIREWALL-BREACH: service_charges+payments % -> % (H2 위반)', v_ledger_touch, v_ledger_after;
  END IF;

  -- ── 판정 ──
  IF v_outside_freeze = 0 AND v_new_cnt = v_freeze_cnt THEN
    v_verdict := 'DRYRUN PASS';
  ELSE
    v_verdict := 'DRYRUN REVIEW';   -- freeze != 순증 또는 이탈생성 → supervisor 판단
  END IF;

  RAISE EXCEPTION
    'DRYRUN_BACKFILL_REPORT % | clinic=% from=% to=% | freeze(expected≈365)=% | processed=% built=% | drafts BEFORE=% AFTER=% new=% | outside_freeze(must=0)=% | amt BEFORE=% AFTER=% new(verbatim)=% | ledger(sc+pay unchanged)=% | (No-Persistence sentinel - txn ABORT expected)',
    v_verdict, v_clinic, v_from, COALESCE(v_to::text,'∞'),
    v_freeze_cnt, v_proc, v_built,
    v_before_cnt, v_after_cnt, v_new_cnt,
    v_outside_freeze,
    v_before_amt, v_after_amt, v_new_amt,
    (v_ledger_after = v_ledger_touch);
END
$DR$;

ROLLBACK;  -- sentinel 예외로 이미 abort — 방어적 명시(비-예외 경로 없음)

-- ============================================================
-- POST-PROBE (별도 mgmt 호출) — 무영속 확인. 아래를 단독 query 로 실행:
--   SELECT count(*) AS should_be_zero
--   FROM public.insurance_claims ic
--   JOIN public.clinics c ON c.id = ic.clinic_id AND c.slug = 'jongno-foot'
--   WHERE ic.claim_status = 'draft'
--     AND ic.calculation_engine_version = 'autodraft_from_charges_v1'
--     AND ic.created_at >= now() - interval '10 minutes';
-- 기대값 0 (dryrun rollback → 신규 draft 미영속). 0 아니면 leak = No-Persistence 위반.

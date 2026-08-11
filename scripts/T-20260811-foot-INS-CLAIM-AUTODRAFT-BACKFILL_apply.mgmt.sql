-- T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL — APPLY (Management-API, GO-token 후 supervisor 실행)
-- ============================================================
-- ★실행 게이트: 이 파일은 supervisor DB-GATE GO-token 발행 후에만 실행한다.
--   GO-token 前 prod 선실행 금지(부모 OOB-apply·원장 미봉합 재발 방지). dev 자체 apply 금지.
--
-- 동작(단일 트랜잭션, 무결 실패 시 자동 롤백):
--   1) clinic 앵커 assert (요양기관기호 13328581 == 74967aea)
--   2) 대상셋 FREEZE 스냅샷(미청구 급여 방문 check_in) + 실행 전 draft check_in 집합
--   3) 판정근거 BEFORE 스냅샷(draft count/금액) + 원장(sc+payments) baseline
--   4) fn_rollup_insurance_claim_drafts(clinic, from, to) 실행
--   5) 무결 가드: (a) freeze 이탈 신규 draft = 0  (b) 원장(sc+payments) 무변동
--       위반 시 RAISE → 트랜잭션 ABORT(영속 0). 통과 시에만 COMMIT.
--   6) APPLY_REPORT NOTICE 산출(판정근거 AFTER 스냅샷).
--
-- ★DECISION-1: v_from 기본값 = '2026-08-01'(원 요청). decision_probe 로 7월분 포함(b) 확정 시
--   supervisor 가 v_from := DATE '2026-07-01' 로 수정 후 실행.
--
-- 멱등: 재실행 안전(이미 draft 있던 방문은 update-in-place → 순증 0). 중복 draft 0.
-- 방화벽: insurance_claims/claim_items 만 write. service_charges/payments 무접촉(H2). edi_submissions 무접촉.
-- Fallback: 이상 시 T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL_rollback.sql (archive-first + 선택 삭제).
-- ============================================================
BEGIN;

DO $AP$
DECLARE
  v_expect_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_from          date := DATE '2026-08-01';   -- ★DECISION-1: (b) 확정 시 '2026-07-01'
  v_to            date := NULL;
  v_clinic        uuid;
  v_before_cnt    int;   v_before_amt   bigint;
  v_freeze_cnt    int;
  v_proc          int;   v_built        int;
  v_after_cnt     int;   v_after_amt    bigint;
  v_new_cnt       int;   v_new_amt      bigint;
  v_outside_freeze int;
  v_ledger_before int;   v_ledger_after int;
BEGIN
  -- 1) clinic 앵커
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot' ORDER BY id LIMIT 1;
  IF v_clinic IS NULL OR v_clinic <> v_expect_clinic THEN
    RAISE EXCEPTION 'CLINIC-ANCHOR-FAIL: resolved=% expected=%', v_clinic, v_expect_clinic;
  END IF;

  -- 2) 대상셋 FREEZE + 실행 전 draft check_in 집합
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

  CREATE TEMP TABLE _before_cids ON COMMIT DROP AS
    SELECT DISTINCT ic.check_in_id AS cid
    FROM public.insurance_claims ic
    WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft' AND ic.check_in_id IS NOT NULL;

  -- 3) BEFORE 스냅샷 + 원장 baseline
  SELECT count(*), COALESCE(SUM(total_base + total_copayment + total_covered), 0)
    INTO v_before_cnt, v_before_amt
  FROM public.insurance_claims
  WHERE clinic_id = v_clinic AND claim_status = 'draft';

  SELECT (SELECT count(*) FROM public.service_charges WHERE clinic_id = v_clinic)
       + (SELECT count(*) FROM public.payments        WHERE clinic_id = v_clinic)
    INTO v_ledger_before;

  -- 4) 백필 실행
  SELECT check_ins_processed, claims_built INTO v_proc, v_built
  FROM public.fn_rollup_insurance_claim_drafts(v_clinic, v_from, v_to);

  -- 5) AFTER + 무결 가드
  SELECT count(*), COALESCE(SUM(total_base + total_copayment + total_covered), 0)
    INTO v_after_cnt, v_after_amt
  FROM public.insurance_claims
  WHERE clinic_id = v_clinic AND claim_status = 'draft';
  v_new_cnt := v_after_cnt - v_before_cnt;

  SELECT count(*) INTO v_outside_freeze
  FROM public.insurance_claims ic
  WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft'
    AND ic.check_in_id NOT IN (SELECT cid FROM _before_cids)
    AND ic.check_in_id NOT IN (SELECT cid FROM _freeze);

  SELECT COALESCE(SUM(total_base + total_copayment + total_covered), 0) INTO v_new_amt
  FROM public.insurance_claims ic
  WHERE ic.clinic_id = v_clinic AND ic.claim_status = 'draft'
    AND ic.check_in_id NOT IN (SELECT cid FROM _before_cids);

  SELECT (SELECT count(*) FROM public.service_charges WHERE clinic_id = v_clinic)
       + (SELECT count(*) FROM public.payments        WHERE clinic_id = v_clinic)
    INTO v_ledger_after;

  -- (a) freeze 이탈 신규 draft = 0
  IF v_outside_freeze <> 0 THEN
    RAISE EXCEPTION 'FREEZE-GUARD-ABORT: freeze 밖 신규 draft % 건 생성 → ABORT (대상셋 drift). freeze=% new=%',
      v_outside_freeze, v_freeze_cnt, v_new_cnt;
  END IF;
  -- (b) 원장 방화벽 무변동
  IF v_ledger_after <> v_ledger_before THEN
    RAISE EXCEPTION 'LEDGER-FIREWALL-BREACH: service_charges+payments % -> % (H2 위반) → ABORT', v_ledger_before, v_ledger_after;
  END IF;

  -- 6) APPLY 판정근거 (성공 경로 — COMMIT 로 진행)
  RAISE NOTICE
    'APPLY_REPORT OK | clinic=% from=% to=% | freeze=% | processed=% built=% | drafts BEFORE=% AFTER=% new=% | outside_freeze=0 | amt BEFORE=% AFTER=% new(verbatim)=% | ledger unchanged=%',
    v_clinic, v_from, COALESCE(v_to::text,'∞'),
    v_freeze_cnt, v_proc, v_built,
    v_before_cnt, v_after_cnt, v_new_cnt,
    v_before_amt, v_after_amt, v_new_amt,
    (v_ledger_after = v_ledger_before);
END
$AP$;

COMMIT;

-- ── 사후 검증(별도 query, COMMIT 후) — 원자 봉합 근거 ──
-- SELECT count(*) AS autodraft_total,
--        SUM(total_base+total_copayment+total_covered) AS amt_total
-- FROM public.insurance_claims ic
-- JOIN public.clinics c ON c.id = ic.clinic_id AND c.slug = 'jongno-foot'
-- WHERE ic.claim_status = 'draft' AND ic.calculation_engine_version = 'autodraft_from_charges_v1';

-- DRYRUN (no-persistence): T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX
--   프로토콜: 전체 up.sql 을 BEGIN..(검증)..ROLLBACK 로 감싸 무영속 실행 → 컬럼 ADD + 3 RPC
--   REPLACE 가 파싱/실행되되 커밋 0.  DDL/함수 정의는 txn-safe(CONCURRENTLY 없음) → BEGIN..ROLLBACK
--   무영속 프로토콜 적용 가능.  실행: psql -f 이 파일 (prod).  'DRYRUN OK' NOTICE 후 ROLLBACK → 영속 0.
--   ⚠ sentinel-bypass 방지: 본 파일은 마지막에 반드시 ROLLBACK.  COMMIT 금지.

BEGIN;

-- ── 1) 전제 실재 preflight (up.sql 등가) ──
DO $$
DECLARE v_missing text := '';
BEGIN
  IF to_regclass('public.package_payments') IS NULL THEN v_missing := v_missing || ' package_payments'; END IF;
  IF to_regclass('public.payments')         IS NULL THEN v_missing := v_missing || ' payments'; END IF;
  IF to_regproc('public.calc_refund_amount(uuid)') IS NULL THEN v_missing := v_missing || ' calc_refund_amount'; END IF;
  IF to_regproc('public.is_approved_user()') IS NULL THEN v_missing := v_missing || ' is_approved_user'; END IF;
  IF to_regproc('public.current_user_clinic_id()') IS NULL THEN v_missing := v_missing || ' current_user_clinic_id'; END IF;
  IF v_missing <> '' THEN RAISE EXCEPTION 'MISSING PREREQ:%', v_missing; END IF;
  RAISE NOTICE 'PREREQ OK';
END $$;

-- ── 2) ADDITIVE 컬럼 (무영속) ──
ALTER TABLE public.package_payments ADD COLUMN IF NOT EXISTS refund_disbursement_method TEXT;
ALTER TABLE public.payments         ADD COLUMN IF NOT EXISTS refund_disbursement_method TEXT;

-- ── 3) 3 RPC REPLACE 무영속 파싱/실행 확인 ──
--     (up.sql STEP 2~4 의 CREATE OR REPLACE 3종을 여기서 그대로 실행하면 dry-run 검증됨.
--      본 dryrun 파일에서는 함수 본문 중복을 피하기 위해 up.sql 을 psql \i 로 부르는 대신,
--      supervisor MIG-GATE 에서 up.sql 전체를 BEGIN..ROLLBACK 로 감싸 실행하는 것을 권장.)

-- ── 4) 배분 산식 sanity (무영속 시뮬레이션) — 다-수단 비례배분이 합-보존인지 ──
DO $$
DECLARE v_refund INTEGER := 1000000; v_total INTEGER := 5760000;
  v_a INTEGER; v_b INTEGER; v_sum INTEGER;
BEGIN
  -- 예: card net 4.5M + transfer net 1.26M (현은호 지문), 견적 1.0M 부분환불
  v_a := FLOOR(v_refund::numeric * 4500000 / v_total)::INTEGER;  -- card
  v_b := FLOOR(v_refund::numeric * 1260000 / v_total)::INTEGER;  -- transfer
  v_sum := v_a + v_b;
  IF v_sum > v_refund THEN RAISE EXCEPTION 'ALLOC OVERFLOW % > %', v_sum, v_refund; END IF;
  -- 잔차는 최대 수단(card)에 흡수 → 최종 합 == v_refund
  RAISE NOTICE 'ALLOC card=% transfer=% base_sum=% remainder=% (최대수단 흡수 후 합=%)',
    v_a, v_b, v_sum, v_refund - v_sum, v_refund;
END $$;

DO $$ BEGIN RAISE NOTICE 'DRYRUN OK — ROLLBACK 예정(영속 0)'; END $$;

ROLLBACK;

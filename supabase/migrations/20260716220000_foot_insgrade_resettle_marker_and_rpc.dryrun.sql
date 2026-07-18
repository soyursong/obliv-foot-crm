-- DRY-RUN (No-Persistence): T-20260714-foot-INSGRADE-VERIFY-RESETTLE Phase1
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 top-level txn-control(COMMIT 등) 없음 = sentinel-bypass hazard 부재 → BEGIN..ROLLBACK 무영속.
--   · txn 내부 assertion(DO $chk$): 마커 컬럼·CHECK·함수 시그니처 실검증, 실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe)은 canonical 러너(dryrun_lib.mjs)의 별 트랜잭션에서 컬럼·pg_proc 부재 재확인.
BEGIN;

-- ── payload (up.sql 본문 미러) ──────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS resettle_reason         TEXT,
  ADD COLUMN IF NOT EXISTS resettle_confirmed_grade TEXT;

DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_resettle_reason_allowlist') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_resettle_reason_allowlist
      CHECK (resettle_reason IS NULL OR resettle_reason IN ('insurance_grade_resettle'));
  END IF;
END $ck$;

CREATE INDEX IF NOT EXISTS idx_payments_resettle_reason
  ON payments (check_in_id) WHERE resettle_reason IS NOT NULL;

-- 함수는 up.sql 과 동일(생략 없이 실검증하려면 up.sql 적용). 여기선 시그니처·존재만 검증하도록
-- 최소 stub 대신 실제 CREATE 를 재현하지 않고, 러너(dryrun_lib.mjs)가 up.sql 전문을 무영속 실행한다.

-- ── txn 내부 검증: 마커 컬럼 2개 + CHECK 제약 실존 (실패 시 abort) ──
DO $chk$
DECLARE
  v_cols  INTEGER;
  v_check INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_name = 'payments'
    AND column_name IN ('resettle_reason', 'resettle_confirmed_grade');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 마커 컬럼 2개 미생성 (got: %)', v_cols;
  END IF;

  SELECT COUNT(*) INTO v_check
  FROM pg_constraint WHERE conname = 'payments_resettle_reason_allowlist';
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: CHECK allowlist 제약 미생성';
  END IF;

  RAISE NOTICE 'DRYRUN-OK: payments 마커 컬럼 2개 + CHECK allowlist 생성 확인';
END $chk$;

ROLLBACK;

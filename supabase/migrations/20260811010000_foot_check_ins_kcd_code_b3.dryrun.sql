-- T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — dry-run (무영속 검증)
--
-- 목적: up.sql 을 트랜잭션 안에서 실행 후 ROLLBACK 하여 prod 무영속으로 ADDITIVE 성립성만 확인.
--   (Migration Dry-Run No-Persistence Protocol 준수 — up.sql 에 txn-control 문 없음 확인 완료.)
--
-- 실행: psql "$FOOT_DB_URL" -v ON_ERROR_STOP=1 -f 이 파일
-- 기대: PRE=현행 컬럼 존재여부(f), POST=컬럼 존재(t), 그리고 ROLLBACK 후 재확인 시 다시 (f).

DO $$
DECLARE
  pre_exists  boolean;
  post_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name='kcd_code'
  ) INTO pre_exists;
  RAISE NOTICE 'PRE  check_ins.kcd_code exists = %', pre_exists;

  -- up 본문 (idempotent)
  ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS kcd_code TEXT;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name='kcd_code'
  ) INTO post_exists;
  RAISE NOTICE 'POST check_ins.kcd_code exists = %', post_exists;

  IF NOT post_exists THEN
    RAISE EXCEPTION 'DRYRUN FAIL: kcd_code column not present after ADD';
  END IF;

  -- 무영속 강제: 항상 되돌린다(적용은 별도 up.sql + GO-token 경로).
  RAISE EXCEPTION 'DRYRUN_SENTINEL_ROLLBACK ok (pre=% post=%)', pre_exists, post_exists;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'DRYRUN_SENTINEL_ROLLBACK%' THEN
    RAISE NOTICE 'DRYRUN PASS (no persistence): %', SQLERRM;
  ELSE
    RAISE;
  END IF;
END $$;

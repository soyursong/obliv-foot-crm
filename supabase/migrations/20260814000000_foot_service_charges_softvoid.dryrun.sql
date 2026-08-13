-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-A (service_charges soft-void) — dry-run (무영속 검증)
--
-- 목적: up.sql 을 트랜잭션 안에서 실행 후 sentinel-ROLLBACK 하여 prod 무영속으로 ADDITIVE 성립성만 확인.
--   (Migration Dry-Run No-Persistence Protocol 준수 — up.sql 에 txn-control(COMMIT 등) 문 없음: BEGIN/COMMIT
--    래퍼는 이 DO 블록이 자체 txn 제어하므로 무관·본 dryrun 은 up 의 ALTER 3문만 실행.)
--
-- 실행: psql "$FOOT_DB_URL" -v ON_ERROR_STOP=1 -f 이 파일
-- 기대: PRE=3컬럼 부재(f), POST=3컬럼 존재(t), sentinel-ROLLBACK 후 무영속(재실행 시 다시 f).

DO $$
DECLARE
  pre_cnt  int;
  post_cnt int;
BEGIN
  SELECT count(*) INTO pre_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='service_charges'
     AND column_name IN ('voided_at','voided_reason','voided_by');
  RAISE NOTICE 'PRE  service_charges void-cols present = % / 3', pre_cnt;

  -- up 본문 (idempotent ADDITIVE)
  ALTER TABLE public.service_charges ADD COLUMN IF NOT EXISTS voided_at     timestamptz NULL;
  ALTER TABLE public.service_charges ADD COLUMN IF NOT EXISTS voided_reason text        NULL;
  ALTER TABLE public.service_charges ADD COLUMN IF NOT EXISTS voided_by     text        NULL;

  SELECT count(*) INTO post_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='service_charges'
     AND column_name IN ('voided_at','voided_reason','voided_by');
  RAISE NOTICE 'POST service_charges void-cols present = % / 3', post_cnt;

  IF post_cnt <> 3 THEN
    RAISE EXCEPTION 'DRYRUN FAIL: expected 3 void-cols after ADD, got %', post_cnt;
  END IF;

  -- 무영속 강제: 항상 되돌린다(적용은 별도 up.sql + GO-token 경로).
  RAISE EXCEPTION 'DRYRUN_SENTINEL_ROLLBACK ok (pre=% post=%)', pre_cnt, post_cnt;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'DRYRUN_SENTINEL_ROLLBACK%' THEN
    RAISE NOTICE 'DRYRUN PASS (no persistence): %', SQLERRM;
  ELSE
    RAISE;
  END IF;
END $$;

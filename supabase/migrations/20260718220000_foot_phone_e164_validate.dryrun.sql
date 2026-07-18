-- DRY-RUN (No-Persistence Protocol): Step3 VALIDATE — T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
-- ============================================================================
-- 프로토콜 준수(sentinel-bypass 차단, migration_dryrun_no_persistence_standard):
--   ① txn-control strip: 실행 body 에 BEGIN/COMMIT 없음(단일 DO 트랜잭션).
--   ② plpgsql exception-handler 실행: VALIDATE 를 DO 내에서 수행 후 末尾 SENTINEL RAISE 로
--      강제 abort → VALIDATE(convalidated 전환) 효과 전부 롤백(무영속).
--   ③ post-probe: 아래 §POST 로 두 제약이 여전히 convalidated=false(NOT VALID) 임을 재확인(비영속 실증).
-- 판정: 'DRYRUN_SENTINEL_OK'(P0001) = 두 제약 VALIDATE 성공(전수 스캔 위반 0) + 무영속 롤백.
--        'DRYRUN_FAIL …' = VALIDATE 후 convalidated!=true (논리 결함).
--        check_violation(23514) = 잔존 위반행 존재 → 백필 미완(재-Step2 필요).
-- 실행: scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_step3_dryrun.mjs (Supabase Mgmt API)
-- ============================================================================

DO $dry$
DECLARE
  v_val_c BOOLEAN;
  v_val_r BOOLEAN;
BEGIN
  -- (1) VALIDATE 무영속 적용 (전수 스캔 → 위반 시 여기서 23514 로 abort)
  ALTER TABLE public.customers    VALIDATE CONSTRAINT customers_phone_e164_chk;
  ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_customer_phone_e164_chk;

  -- (2) convalidated 전환 착지 검증
  SELECT convalidated INTO v_val_c FROM pg_constraint WHERE conname='customers_phone_e164_chk';
  SELECT convalidated INTO v_val_r FROM pg_constraint WHERE conname='reservations_customer_phone_e164_chk';
  IF v_val_c IS DISTINCT FROM true OR v_val_r IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DRYRUN_FAIL>> VALIDATE 후 convalidated 미전환: c=% r=%', v_val_c, v_val_r;
  END IF;
  RAISE NOTICE 'VALIDATE-OK: 두 제약 convalidated=true (전수 스캔 위반 0)';

  -- (3) SENTINEL RAISE → 트랜잭션 abort = VALIDATE 효과 롤백(무영속)
  RAISE EXCEPTION 'DRYRUN_SENTINEL_OK>> VALIDATE 성공(convalidated=true) + 무영속 롤백';
END $dry$;

-- §POST (별도 실행) — 무영속 실증: 여전히 convalidated=false 이어야 함
-- SELECT conname, convalidated FROM pg_constraint
--   WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk');

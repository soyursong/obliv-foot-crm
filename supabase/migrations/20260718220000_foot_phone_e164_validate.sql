-- Step3 (ADDITIVE): T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
-- ============================================================================
-- 목적: Step2 백필(customers 29 + reservations 98 정정, 잔존 위반 0 실증) 완료 후,
--       parent Step1(20260713160000)이 NOT VALID 로 세운 두 E.164 CHECK 제약을
--       VALIDATE 하여 convalidated=true 로 전환(전수 스캔 통과 확정).
-- 성격: ADDITIVE. 데이터/스키마 구조 무변경, 제약식 무변경. convalidated 플래그만 false→true.
--       VALIDATE CONSTRAINT = SHARE UPDATE EXCLUSIVE 락(읽기·쓰기 비블로킹 스캔).
-- 선행: Step2 backfill 완료 (full-table CHECK verbatim 위반 0, 2026-07-18 실측).
-- 게이트: supervisor DDL-diff (dry-run evidence = *.dryrun.sql 무영속 PASS 동봉).
-- ============================================================================

ALTER TABLE public.customers    VALIDATE CONSTRAINT customers_phone_e164_chk;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_customer_phone_e164_chk;

-- Rollback: 20260812080000_foot_testacct8_legB2_istest_flag_2acct
-- Ticket: T-20260810-foot-TESTACCT-CLEANUP-8ACCT (Leg B 2차)
-- 완전가역 — flag 2건만 false 원복. is_test 컬럼 자체는 Leg B infra 소유(DROP 하지 않음).
-- ★ 컬럼 DROP 은 Leg B infra rollback(20260811020000_..._flag_vdailyrev.rollback.sql) 소관.

BEGIN;

UPDATE public.customers
   SET is_test = false
 WHERE id IN (
   'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,  -- F-4427 풋테스트1
   '66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid   -- F-4445 박민석(별건)
 );

COMMIT;

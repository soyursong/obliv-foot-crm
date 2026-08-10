-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B 2차 is_test flag 2건 원복.
-- 본 마이그가 flag 한 2건(F-4427·F-4445)만 false 로 원복. Leg B 1차 3계정(F-4574/F-4990/F-5113)은 무접촉.
-- 멱등: 재실행 no-op(이미 false).
BEGIN;

UPDATE public.customers SET is_test = false
 WHERE id IN ('e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid,   -- F-4427
              '66c08e48-c708-4e50-963d-aaa56b27d9ea'::uuid)   -- F-4445
   AND is_test IS DISTINCT FROM false;  -- expect rows-affected = 2

COMMIT;
-- POSTCHECK: is_test=true = 3건(F-4574,F-4990,F-5113 — 1차분만 잔존) / F-4427,F-4445 = false.

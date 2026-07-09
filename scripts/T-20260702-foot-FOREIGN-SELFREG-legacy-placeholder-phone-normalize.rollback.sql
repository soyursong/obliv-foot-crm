-- ============================================================
-- ROLLBACK — T-20260702-foot STAGE2 (d) legacy placeholder 정규화 원복
--   before-image 스냅샷 기준 4행 phone 복원(SOP §3-2). 트리거가 phone_dummy=false 재파생.
-- ⚠ 대상 PK 가 여전히 DUMMY-% 일 때만 복원(정규화 직후 상태). 이후 재수정된 행은 건드리지 않음.
-- ============================================================

BEGIN;

UPDATE public.customers SET phone = '0'
 WHERE id = 'd330baa7-45b0-44b8-9711-c76c8628f450' AND phone LIKE 'DUMMY-%';
UPDATE public.customers SET phone = '000'
 WHERE id = 'ce00c1af-14ff-4542-9142-9ac9e329c6ee' AND phone LIKE 'DUMMY-%';
UPDATE public.customers SET phone = '000-0001-1111'
 WHERE id = '06e744e0-b881-4dc0-b8ed-cec78fc73212' AND phone LIKE 'DUMMY-%';
UPDATE public.customers SET phone = '000-0111-0000'
 WHERE id = '5a64b5c5-6fbf-4929-ae95-14d525147e11' AND phone LIKE 'DUMMY-%';

DO $$
DECLARE v_restored INT;
BEGIN
  SELECT count(*) INTO v_restored
    FROM public.customers
   WHERE id IN (
           'd330baa7-45b0-44b8-9711-c76c8628f450',
           'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
           '06e744e0-b881-4dc0-b8ed-cec78fc73212',
           '5a64b5c5-6fbf-4929-ae95-14d525147e11'
         )
     AND phone IN ('0', '000', '000-0001-1111', '000-0111-0000');
  RAISE NOTICE '[ROLLBACK d] before-image 복원 = % 행 (트리거가 phone_dummy=false 재파생)', v_restored;
END $$;

COMMIT;

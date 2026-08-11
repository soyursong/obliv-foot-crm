-- ROLLBACK: T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE
-- 수동 '공휴일 초진진찰료-의원'(24,490, id=3eb86239) 폐기(active=false) 되돌리기.
-- 되돌릴 수 있는 config 변경 (DDL 없음).
UPDATE public.services
SET active = true
WHERE id = '3eb86239-af92-468c-afd3-94daa28acad6'
  AND name = '공휴일 초진진찰료-의원'
  AND price = 24490;
-- 검증: 1 row affected 여야 함.

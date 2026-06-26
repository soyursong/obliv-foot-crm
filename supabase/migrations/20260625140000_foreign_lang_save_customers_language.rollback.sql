-- ROLLBACK — T-20260625-foot-FOREIGN-LANG-SAVE
-- customers.language 컬럼 제거. ADDITIVE의 역연산(데이터 손실 주의: 입력된 언어값 소멸).
BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS language;

COMMIT;

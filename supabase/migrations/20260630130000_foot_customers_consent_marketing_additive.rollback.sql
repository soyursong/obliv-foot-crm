-- ROLLBACK: T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL — customers.consent_marketing 제거
-- 비파괴 ADDITIVE 의 역방향. 컬럼만 제거(기존 데이터/정책 무영향).
-- ⚠ 롤백 시 reservation-ingest 신규 customer INSERT 가 다시 500 으로 회귀하므로
--   현장 RED 재발. EF 회귀(consent_marketing 미참조) 동반 없이는 운영 롤백 금지.

BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS consent_marketing;

COMMIT;

NOTIFY pgrst, 'reload schema';

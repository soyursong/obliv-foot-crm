-- ROLLBACK: T-20260628-crm-RESV-CREATED-VIA-FILL §2 (dev-foot)
-- created_via CHECK + 컬럼 제거. (적재값 손실 주의 — 운영 중 적재 후 롤백 시 created_via 데이터 소실)
-- CHECK만 되돌리려면 ADD COLUMN 라인 실행 금지하고 아래 DROP CONSTRAINT만.

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_created_via_check;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS created_via;

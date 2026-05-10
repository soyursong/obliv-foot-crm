-- T-20260510-foot-ADDRESS-DETAIL-FIX
-- 고객 상세주소 입력란 추가
-- Rollback: 20260510000030_customers_address_detail.down.sql

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address_detail TEXT;

COMMENT ON COLUMN public.customers.address_detail IS '상세주소 (동·호수·건물명 등) — T-20260510-foot-ADDRESS-DETAIL-FIX';

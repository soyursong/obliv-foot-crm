-- Rollback: T-20260510-foot-SVCMENU-REVAMP
-- seed 데이터는 idempotent (ON CONFLICT DO UPDATE), 롤백은 컬럼만 제거
ALTER TABLE public.services DROP COLUMN IF EXISTS category_label;

-- T-20260507-foot-CHART2-INSURANCE-FIELDS: 건보 필수 필드 — 주소지 컬럼 추가
-- 롤백: ALTER TABLE customers DROP COLUMN IF EXISTS address;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;

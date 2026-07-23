-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260723-foot-REDPAY-PLANB-DDL-BUILD (20260723180100_foot_redpay_raw_received_at.sql)
-- ══════════════════════════════════════════════════════════════════
-- ADDITIVE 컬럼의 정확한 역연산. DROP COLUMN 이 COMMENT 도 함께 제거.
--   ⚠ 웹훅이 이미 received_at 을 채운 뒤라면 관측치 소실 → 운영 롤백 시 supervisor 사전확인.
--   무접촉: redpay_raw_transactions 다른 컬럼·제약·인덱스·RLS 미변경.
-- 멱등: DROP COLUMN IF EXISTS (재실행 무해).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.redpay_raw_transactions
  DROP COLUMN IF EXISTS received_at;

COMMIT;

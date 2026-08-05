-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP (신규 288007 admission 역전)
-- ══════════════════════════════════════════════════════════════════
-- 신규 편입 1 merchant(1777288007, domain='foot') DELETE → 25-set 복원. 데이터손실 0(seed 데이터만 제거).
--   ⚠ 롤백 후 폴러 DEFAULT(288007 parity)·env(REDPAY_*_WHITELIST)도 되돌려야 소비처 정합.
--   raw_transactions 백필분(재폴링 재적재)은 별도(원장 무접점 seed 롤백은 raw 를 건드리지 않음).
--   (신규 admission → 旣존재 UPDATE 가 아니므로 before-image 복원 불요. 단순 신규행 제거로 원상복구.)
-- ══════════════════════════════════════════════════════════════════

DELETE FROM public.redpay_terminal_registry
WHERE domain = 'foot'
  AND merchant_id = '1777288007';

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260806090000';

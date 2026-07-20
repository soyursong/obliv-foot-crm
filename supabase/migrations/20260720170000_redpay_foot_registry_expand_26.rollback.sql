-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND (풋 registry 17→26)
-- ══════════════════════════════════════════════════════════════════
-- 신규 편입 9 merchant(domain='foot') DELETE → 17-set 복원. 데이터손실 0(seed 데이터만 제거).
--   ⚠ 롤백 후 폴러 env(REDPAY_*_WHITELIST 26)·코드 DEFAULT(26)도 17로 되돌려야 소비처 정합.
--   raw_transactions 백필분은 별도(원장 무접점 seed 롤백은 raw 를 건드리지 않음).
-- ══════════════════════════════════════════════════════════════════

DELETE FROM public.redpay_terminal_registry
WHERE domain = 'foot'
  AND merchant_id IN (
    '1777285003', '1777285005', '1777285006', '1777285007', '1777285008',
    '1777288003', '1777288005', '1777288006', '1777288008'
  );

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260720170000';

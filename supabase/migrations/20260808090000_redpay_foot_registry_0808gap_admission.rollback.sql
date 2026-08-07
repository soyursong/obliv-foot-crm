-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP (신규 288002 admission 역전)
-- ══════════════════════════════════════════════════════════════════
-- 신규 편입 1 merchant(1777288002, domain='foot') DELETE → 26-set 복원. 데이터손실 0(seed 데이터만 제거).
--   ⚠ 롤백 후 폴러 DEFAULT(288002 parity)·env(REDPAY_*_WHITELIST)도 되돌려야 소비처 정합.
--   raw_transactions 백필분 없음(AC-5 forward-capture only, raw 미적재 → seed 롤백은 raw 무접점).
--   (신규 admission → 旣존재 UPDATE 가 아니므로 before-image 복원 불요. 단순 신규행 제거로 원상복구.)
--   ★scope 격리: 288007(0806GAP)은 무접촉 — 본 롤백은 288002 단일 행만 제거.
-- ══════════════════════════════════════════════════════════════════

DELETE FROM public.redpay_terminal_registry
WHERE domain = 'foot'
  AND merchant_id = '1777288002';

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260808090000';

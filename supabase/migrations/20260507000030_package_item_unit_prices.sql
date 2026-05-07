-- T-20260507-foot-PKG-TEMPLATE-REDESIGN
-- packages 테이블에 항목별 수가 컬럼 추가
-- 패키지 생성 폼 전면 재설계 — 항목별 [회수/수가] 자동합산 지원
--
-- Rollback SQL:
--   ALTER TABLE packages
--     DROP COLUMN IF EXISTS heated_unit_price,
--     DROP COLUMN IF EXISTS unheated_unit_price,
--     DROP COLUMN IF EXISTS iv_unit_price;

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS heated_unit_price   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unheated_unit_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iv_unit_price       INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN packages.heated_unit_price   IS '가열 레이저 회당 수가 (T-20260507-foot-PKG-TEMPLATE-REDESIGN)';
COMMENT ON COLUMN packages.unheated_unit_price IS '비가열 레이저 회당 수가';
COMMENT ON COLUMN packages.iv_unit_price       IS '수액 회당 수가';
